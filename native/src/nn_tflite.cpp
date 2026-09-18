#include "nn_graph.hpp"
#include <algorithm>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <string>

// TensorFlow Lite loader: the flatbuffer read directly (schema v3), for the
// operators MediaPipe's face landmark and blendshape models use. Field ids
// follow tensorflow/lite/schema/schema.fbs.
namespace lenslabs::nn {
namespace {

[[noreturn]] void fail(const std::string& message) { throw std::invalid_argument("TFLite: " + message); }

class Buffer {
 public:
  Buffer(const std::uint8_t* data, std::size_t size) : data_(data), size_(size) {}

  template <class T> T read(std::size_t at) const {
    if (at > size_ || size_ - at < sizeof(T)) fail("read past the end of the model");
    T value;
    std::memcpy(&value, data_ + at, sizeof(T));
    return value;
  }
  const std::uint8_t* bytes(std::size_t at, std::size_t count) const {
    if (at > size_ || size_ - at < count) fail("read past the end of the model");
    return data_ + at;
  }

 private:
  const std::uint8_t* data_;
  std::size_t size_;
};

// A flatbuffer table: fields are found through the vtable, and an absent field
// reads as its schema default.
class Table {
 public:
  Table(const Buffer& buffer, std::size_t at) : buffer_(&buffer), at_(at) {
    const auto offset = buffer.read<std::int32_t>(at);
    const auto vtable = std::int64_t(at) - offset;
    if (vtable < 0) fail("invalid vtable");
    vtable_ = std::size_t(vtable);
    vtable_size_ = buffer.read<std::uint16_t>(vtable_);
    if (vtable_size_ < 4 || vtable_size_ % 2) fail("invalid vtable size");
  }

  std::size_t field(int id) const {
    const std::size_t slot = 4 + std::size_t(id) * 2;
    if (slot + 2 > vtable_size_) return 0;
    const auto offset = buffer_->read<std::uint16_t>(vtable_ + slot);
    return offset ? at_ + offset : 0;
  }
  template <class T> T scalar(int id, T fallback = T{}) const {
    const auto at = field(id);
    return at ? buffer_->read<T>(at) : fallback;
  }
  // Offset fields (tables, vectors, strings) hold a uoffset from where they sit.
  std::size_t reference(int id) const {
    const auto at = field(id);
    return at ? at + buffer_->read<std::uint32_t>(at) : 0;
  }
  Table table(int id) const {
    const auto at = reference(id);
    if (!at) fail("missing table");
    return Table(*buffer_, at);
  }
  bool has(int id) const { return field(id) != 0; }

  // Vector helpers.
  std::uint32_t length(int id) const {
    const auto at = reference(id);
    return at ? buffer_->read<std::uint32_t>(at) : 0;
  }
  template <class T> T element(int id, std::uint32_t index) const {
    const auto at = reference(id);
    if (!at || index >= buffer_->read<std::uint32_t>(at)) fail("vector index out of range");
    return buffer_->read<T>(at + 4 + std::size_t(index) * sizeof(T));
  }
  Table table_at(int id, std::uint32_t index) const {
    const auto at = reference(id);
    if (!at || index >= buffer_->read<std::uint32_t>(at)) fail("vector index out of range");
    const auto slot = at + 4 + std::size_t(index) * 4;
    return Table(*buffer_, slot + buffer_->read<std::uint32_t>(slot));
  }
  std::string string(int id) const {
    const auto at = reference(id);
    if (!at) return {};
    const auto size = buffer_->read<std::uint32_t>(at);
    return std::string(reinterpret_cast<const char*>(buffer_->bytes(at + 4, size)), size);
  }
  std::pair<const std::uint8_t*, std::uint32_t> bytes(int id) const {
    const auto at = reference(id);
    if (!at) return {nullptr, 0};
    const auto size = buffer_->read<std::uint32_t>(at);
    return {buffer_->bytes(at + 4, size), size};
  }

 private:
  const Buffer* buffer_;
  std::size_t at_;
  std::size_t vtable_ = 0;
  std::uint16_t vtable_size_ = 0;
};

enum Builtin : int {
  ADD = 0, CONCATENATION = 2, CONV_2D = 3, DEPTHWISE_CONV_2D = 4, DEQUANTIZE = 6, LOGISTIC = 14,
  MAX_POOL_2D = 17, MUL = 18, RELU = 19, RESHAPE = 22, PAD = 34, TRANSPOSE = 39, MEAN = 40, SUB = 41,
  DIV = 42, STRIDED_SLICE = 45, PRELU = 54, NEG = 59, SUM = 74, SQRT = 75, RSQRT = 76,
  SQUARED_DIFFERENCE = 99,
};
enum TensorType : int { FLOAT32 = 0, FLOAT16 = 1, INT32 = 2, INT64 = 4 };

Activation activation_of(std::int8_t code) {
  switch (code) {
    case 0: return Activation::none;
    case 1: return Activation::relu;
    case 3: return Activation::relu6;
    default: fail("unsupported fused activation " + std::to_string(code));
  }
}

bool same_padding(std::int8_t padding) {
  if (padding == 0) return true;   // SAME
  if (padding == 1) return false;  // VALID
  fail("unsupported padding");
}

} // namespace

Model Model::tflite(const std::uint8_t* bytes, std::size_t size) {
  if (!bytes || size < 8) fail("empty model");
  const Buffer buffer(bytes, size);
  const Table model(buffer, buffer.read<std::uint32_t>(0));
  if (model.scalar<std::uint32_t>(0) != 3) fail("unsupported schema version");
  if (model.length(2) != 1) fail("expected exactly one subgraph");
  const Table subgraph = model.table_at(2, 0);

  auto graph = std::make_unique<Graph>();
  const auto tensor_count = subgraph.length(0);
  for (std::uint32_t t = 0; t < tensor_count; ++t) {
    const Table tensor = subgraph.table_at(0, t);
    const int id = graph->add_value(tensor.string(3));
    auto& value = graph->values[std::size_t(id)];
    for (std::uint32_t d = 0; d < tensor.length(0); ++d) value.tensor.shape.push_back(tensor.element<std::int32_t>(0, d));
    const auto buffer_index = tensor.scalar<std::uint32_t>(2);
    if (buffer_index == 0 || buffer_index >= model.length(4)) continue; // buffer 0 is the empty sentinel
    const Table data_buffer = model.table_at(4, buffer_index);
    const auto [data, data_size] = data_buffer.bytes(0);
    if (!data || !data_size) {
      if (data_buffer.scalar<std::uint64_t>(1)) fail("external buffers are not supported");
      continue;
    }
    // Constant tensor. Weights are decoded to float32 here; integer tensors
    // carry shapes, axes and permutations and fit exactly in a float.
    const auto count = element_count(value.tensor.shape);
    const auto type = tensor.scalar<std::int8_t>(1);
    value.constant = true;
    value.tensor.data.resize(count);
    const auto expect = [&](std::size_t width) {
      if (std::size_t(data_size) != count * width) fail("constant tensor size mismatch");
    };
    switch (type) {
      case FLOAT32:
        expect(4);
        std::memcpy(value.tensor.data.data(), data, count * 4);
        break;
      case FLOAT16:
        expect(2);
        for (std::size_t i = 0; i < count; ++i) {
          std::uint16_t half;
          std::memcpy(&half, data + i * 2, 2);
          value.tensor.data[i] = half_to_float(half);
        }
        break;
      case INT32:
        expect(4);
        for (std::size_t i = 0; i < count; ++i) {
          std::int32_t v;
          std::memcpy(&v, data + i * 4, 4);
          value.tensor.data[i] = float(v);
        }
        break;
      case INT64:
        expect(8);
        for (std::size_t i = 0; i < count; ++i) {
          std::int64_t v;
          std::memcpy(&v, data + i * 8, 8);
          value.tensor.data[i] = float(v);
        }
        break;
      default: fail("unsupported constant type " + std::to_string(type));
    }
  }

  const auto tensor_id = [&](std::int32_t index) {
    if (index < 0) return -1;
    if (std::uint32_t(index) >= tensor_count) fail("tensor index out of range");
    return int(index);
  };
  for (std::uint32_t i = 0; i < subgraph.length(1); ++i) graph->inputs.push_back(tensor_id(subgraph.element<std::int32_t>(1, i)));
  for (std::uint32_t i = 0; i < subgraph.length(2); ++i) graph->outputs.push_back(tensor_id(subgraph.element<std::int32_t>(2, i)));

  const auto op_count = subgraph.length(3);
  for (std::uint32_t k = 0; k < op_count; ++k) {
    const Table node = subgraph.table_at(3, k);
    const auto code_index = node.scalar<std::uint32_t>(0);
    if (code_index >= model.length(1)) fail("operator code out of range");
    const Table code = model.table_at(1, code_index);
    // Newer files store codes above 127 in builtin_code; older ones only in
    // the deprecated int8 field. The larger of the two is the real one.
    const int builtin = std::max<int>(code.scalar<std::int8_t>(0), code.scalar<std::int32_t>(3));
    if (code.has(1)) fail("custom operator " + code.string(1));

    Op op;
    op.layout = Layout::nhwc;
    for (std::uint32_t i = 0; i < node.length(1); ++i) op.inputs.push_back(tensor_id(node.element<std::int32_t>(1, i)));
    for (std::uint32_t i = 0; i < node.length(2); ++i) op.outputs.push_back(tensor_id(node.element<std::int32_t>(2, i)));
    if (op.outputs.size() != 1 || op.outputs[0] < 0) fail("operators must have exactly one output");
    const bool has_options = node.has(4);
    const auto options = [&] { return node.table(4); };

    switch (builtin) {
      case CONV_2D:
      case DEPTHWISE_CONV_2D: {
        op.kind = Kind::conv;
        op.depthwise = builtin == DEPTHWISE_CONV_2D;
        if (!has_options) fail("convolution without options");
        const Table o = options();
        op.same = same_padding(o.scalar<std::int8_t>(0));
        op.stride_w = o.scalar<std::int32_t>(1);
        op.stride_h = o.scalar<std::int32_t>(2);
        if (op.depthwise) {
          op.depth_multiplier = o.scalar<std::int32_t>(3, 1);
          op.activation = activation_of(o.scalar<std::int8_t>(4));
          op.dilation_w = o.scalar<std::int32_t>(5, 1);
          op.dilation_h = o.scalar<std::int32_t>(6, 1);
        } else {
          op.activation = activation_of(o.scalar<std::int8_t>(3));
          op.dilation_w = o.scalar<std::int32_t>(4, 1);
          op.dilation_h = o.scalar<std::int32_t>(5, 1);
        }
        if (op.inputs.size() < 2) fail("convolution without weights");
        break;
      }
      case MAX_POOL_2D: {
        op.kind = Kind::max_pool;
        if (!has_options) fail("pooling without options");
        const Table o = options();
        op.same = same_padding(o.scalar<std::int8_t>(0));
        op.stride_w = o.scalar<std::int32_t>(1);
        op.stride_h = o.scalar<std::int32_t>(2);
        op.kernel_w = o.scalar<std::int32_t>(3);
        op.kernel_h = o.scalar<std::int32_t>(4);
        op.activation = activation_of(o.scalar<std::int8_t>(5));
        break;
      }
      case ADD:
      case SUB:
      case MUL:
      case DIV:
        op.kind = builtin == ADD ? Kind::add : builtin == SUB ? Kind::sub : builtin == MUL ? Kind::mul : Kind::div;
        if (has_options && options().scalar<std::int8_t>(0) != 0)
          fail("fused activations on elementwise operators are not supported");
        break;
      case SQUARED_DIFFERENCE: op.kind = Kind::squared_difference; break;
      case NEG: op.kind = Kind::neg; break;
      case RELU: op.kind = Kind::relu; break;
      case PRELU: op.kind = Kind::prelu; break;
      case LOGISTIC: op.kind = Kind::sigmoid; break;
      case SQRT: op.kind = Kind::sqrt; break;
      case RSQRT: op.kind = Kind::rsqrt; break;
      case DEQUANTIZE: op.kind = Kind::dequantize; break;
      case TRANSPOSE: op.kind = Kind::transpose; break;
      case PAD: op.kind = Kind::pad; break;
      case RESHAPE:
        op.kind = Kind::reshape;
        // The shape comes from the second input when present, otherwise from
        // the options' new_shape.
        if (op.inputs.size() < 2 || op.inputs[1] < 0) {
          if (!has_options) fail("reshape without a shape");
          const Table o = options();
          for (std::uint32_t i = 0; i < o.length(0); ++i) op.ints.push_back(o.element<std::int32_t>(0, i));
          op.inputs.resize(1);
        }
        break;
      case MEAN:
      case SUM:
        op.kind = builtin == MEAN ? Kind::mean : Kind::sum;
        op.keep_dims = has_options && options().scalar<std::uint8_t>(0) != 0;
        if (op.inputs.size() != 2) fail("reduction without axes");
        break;
      case STRIDED_SLICE: {
        op.kind = Kind::strided_slice;
        if (has_options) {
          const Table o = options();
          op.begin_mask = o.scalar<std::int32_t>(0);
          op.end_mask = o.scalar<std::int32_t>(1);
          if (o.scalar<std::int32_t>(2) || o.scalar<std::int32_t>(3)) fail("ellipsis and new-axis slices are not supported");
          op.shrink_mask = o.scalar<std::int32_t>(4);
          if (o.scalar<std::uint8_t>(5)) fail("offset slices are not supported");
        }
        if (op.inputs.size() != 4) fail("strided slice needs begin, end and strides");
        break;
      }
      case CONCATENATION: {
        op.kind = Kind::concat;
        if (!has_options) fail("concatenation without options");
        const Table o = options();
        op.axis = o.scalar<std::int32_t>(0);
        if (o.scalar<std::int8_t>(1) != 0) fail("fused activation on concatenation is not supported");
        break;
      }
      default: fail("unsupported operator " + std::to_string(builtin));
    }
    graph->ops.push_back(std::move(op));
  }
  if (graph->inputs.empty() || graph->outputs.empty()) fail("graph has no inputs or outputs");
  graph->finalize();
  return Model(std::move(graph));
}

} // namespace lenslabs::nn
