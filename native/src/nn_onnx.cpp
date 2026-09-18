#include "nn_graph.hpp"
#include <cstring>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string_view>
#include <unordered_map>

// ONNX loader: the protobuf wire format read directly, for the operator set
// YuNet uses (opset 11). Anything else is refused by name rather than guessed.
namespace lenslabs::nn {
namespace {

[[noreturn]] void fail(const std::string& message) { throw std::invalid_argument("ONNX: " + message); }

// One protobuf message, walked field by field with every read bounds-checked.
class Message {
 public:
  Message(const std::uint8_t* data, std::size_t size) : at_(data), end_(data + size) {}

  bool next() {
    if (at_ >= end_) return false;
    const auto key = varint();
    field = std::uint32_t(key >> 3);
    wire = int(key & 7);
    switch (wire) {
      case 0: value = varint(); break;
      case 1: take(8, bytes); length = 8; break;
      case 2: length = std::size_t(varint()); take(length, bytes); break;
      case 5: take(4, bytes); length = 4; break;
      default: fail("unsupported protobuf wire type");
    }
    return true;
  }
  std::string_view text() const { return {reinterpret_cast<const char*>(bytes), length}; }
  Message sub() const { return Message(bytes, length); }
  float fixed_float() const {
    float v;
    std::memcpy(&v, bytes, 4);
    return v;
  }

  std::uint32_t field = 0;
  int wire = 0;
  std::uint64_t value = 0;
  const std::uint8_t* bytes = nullptr;
  std::size_t length = 0;

  std::uint64_t varint() {
    std::uint64_t result = 0;
    for (int shift = 0; shift < 64; shift += 7) {
      if (at_ >= end_) fail("truncated varint");
      const auto byte = *at_++;
      result |= std::uint64_t(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
    }
    fail("overlong varint");
  }

 private:
  void take(std::size_t count, const std::uint8_t*& out) {
    if (std::size_t(end_ - at_) < count) fail("truncated field");
    out = at_;
    at_ += count;
  }
  const std::uint8_t* at_;
  const std::uint8_t* end_;
};

// Repeated int64 fields arrive packed or one per entry; both are accepted.
void append_ints(const Message& m, std::vector<std::int64_t>& out) {
  if (m.wire == 0) {
    out.push_back(std::int64_t(m.value));
  } else if (m.wire == 2) {
    // A packed run is a sequence of bare varints, with no keys between them.
    const std::uint8_t* at = m.bytes;
    const std::uint8_t* end = m.bytes + m.length;
    while (at < end) {
      std::uint64_t result = 0;
      int shift = 0;
      while (true) {
        if (at >= end || shift >= 64) fail("truncated packed varint");
        const auto byte = *at++;
        result |= std::uint64_t(byte & 0x7f) << shift;
        shift += 7;
        if (!(byte & 0x80)) break;
      }
      out.push_back(std::int64_t(result));
    }
  } else {
    fail("unexpected wire type for integers");
  }
}

struct Attribute {
  std::string name;
  std::int64_t i = 0;
  float f = 0;
  std::string s;
  std::vector<std::int64_t> ints;
  std::vector<float> floats;
};

Attribute read_attribute(Message m) {
  Attribute a;
  while (m.next()) {
    switch (m.field) {
      case 1: a.name = std::string(m.text()); break;
      case 2: if (m.wire == 5) a.f = m.fixed_float(); break;
      case 3: a.i = std::int64_t(m.value); break;
      case 4: a.s = std::string(m.text()); break;
      case 7:
        if (m.wire == 5) a.floats.push_back(m.fixed_float());
        else if (m.wire == 2)
          for (std::size_t k = 0; k + 4 <= m.length; k += 4) {
            float v;
            std::memcpy(&v, m.bytes + k, 4);
            a.floats.push_back(v);
          }
        break;
      case 8: append_ints(m, a.ints); break;
      default: break;
    }
  }
  return a;
}

struct Initializer {
  std::string name;
  Tensor tensor;
};

// Integer initializers become float tensors: they only ever carry shapes,
// axes and permutations, all far inside float's exact integer range.
Initializer read_initializer(Message m) {
  Initializer out;
  std::vector<std::int64_t> dims, int64_data;
  std::int64_t type = 0;
  const std::uint8_t* raw = nullptr;
  std::size_t raw_size = 0;
  std::vector<float> float_data;
  while (m.next()) {
    switch (m.field) {
      case 1: append_ints(m, dims); break;
      case 2: type = std::int64_t(m.value); break;
      case 4:
        if (m.wire == 2)
          for (std::size_t k = 0; k + 4 <= m.length; k += 4) {
            float v;
            std::memcpy(&v, m.bytes + k, 4);
            float_data.push_back(v);
          }
        else if (m.wire == 5) float_data.push_back(m.fixed_float());
        break;
      case 7: append_ints(m, int64_data); break;
      case 8: out.name = std::string(m.text()); break;
      case 9: raw = m.bytes; raw_size = m.length; break;
      default: break;
    }
  }
  for (const auto d : dims) {
    if (d < 0 || d > (1 << 24)) fail("initializer dimension out of range");
    out.tensor.shape.push_back(int(d));
  }
  const auto count = element_count(out.tensor.shape);
  if (count > (std::size_t(1) << 28)) fail("initializer too large");
  out.tensor.data.resize(count);
  if (type == 1) { // FLOAT
    if (raw) {
      if (raw_size != count * 4) fail("float initializer size mismatch");
      std::memcpy(out.tensor.data.data(), raw, raw_size);
    } else {
      if (float_data.size() != count) fail("float initializer size mismatch");
      out.tensor.data = float_data;
    }
  } else if (type == 7) { // INT64
    if (raw) {
      if (raw_size != count * 8) fail("int64 initializer size mismatch");
      for (std::size_t i = 0; i < count; ++i) {
        std::int64_t v;
        std::memcpy(&v, raw + i * 8, 8);
        out.tensor.data[i] = float(v);
      }
    } else {
      if (int64_data.size() != count) fail("int64 initializer size mismatch");
      for (std::size_t i = 0; i < count; ++i) out.tensor.data[i] = float(int64_data[i]);
    }
  } else {
    fail("unsupported initializer type " + std::to_string(type));
  }
  return out;
}

std::string value_name(Message m) {
  while (m.next())
    if (m.field == 1) return std::string(m.text());
  return {};
}

int as_int(std::int64_t v) {
  if (v < -(1 << 24) || v > (1 << 24)) fail("attribute out of range");
  return int(v);
}

} // namespace

Model Model::onnx(const std::uint8_t* bytes, std::size_t size) {
  if (!bytes || !size) fail("empty model");
  Message model(bytes, size);
  std::optional<Message> graph_message;
  while (model.next())
    if (model.field == 7 && model.wire == 2) graph_message = model.sub();
  if (!graph_message) fail("no graph");

  auto graph = std::make_unique<Graph>();
  std::unordered_map<std::string, int> ids;
  const auto id_of = [&](const std::string& name) {
    if (name.empty()) return -1; // an omitted optional input
    const auto found = ids.find(name);
    if (found != ids.end()) return found->second;
    const int id = graph->add_value(name);
    ids.emplace(name, id);
    return id;
  };

  std::vector<Message> nodes;
  std::vector<std::string> input_names, output_names;
  Message g = *graph_message;
  while (g.next()) {
    if (g.wire != 2) continue;
    if (g.field == 1) nodes.push_back(g.sub());
    else if (g.field == 5) {
      auto init = read_initializer(g.sub());
      const int id = id_of(init.name);
      auto& value = graph->values[std::size_t(id)];
      value.constant = true;
      value.tensor = std::move(init.tensor);
    } else if (g.field == 11) input_names.push_back(value_name(g.sub()));
    else if (g.field == 12) output_names.push_back(value_name(g.sub()));
  }

  for (auto node : nodes) {
    std::vector<std::string> inputs, outputs;
    std::string type;
    std::vector<Attribute> attributes;
    while (node.next()) {
      if (node.field == 1) inputs.emplace_back(node.text());
      else if (node.field == 2) outputs.emplace_back(node.text());
      else if (node.field == 4) type = std::string(node.text());
      else if (node.field == 5 && node.wire == 2) attributes.push_back(read_attribute(node.sub()));
    }
    const auto attribute = [&](const char* name) -> const Attribute* {
      for (const auto& a : attributes)
        if (a.name == name) return &a;
      return nullptr;
    };
    if (outputs.size() != 1) fail(type + " must have exactly one output");

    Op op;
    op.layout = Layout::nchw;
    for (const auto& name : inputs) op.inputs.push_back(id_of(name));
    op.outputs.push_back(id_of(outputs[0]));

    const auto spatial = [&](bool conv) {
      if (const auto* a = attribute("auto_pad"); a && !a->s.empty() && a->s != "NOTSET")
        fail(type + " auto_pad is not supported");
      if (const auto* k = attribute("kernel_shape")) {
        if (k->ints.size() != 2) fail(type + " must be 2-D");
        op.kernel_h = as_int(k->ints[0]), op.kernel_w = as_int(k->ints[1]);
      } else if (!conv) {
        fail(type + " needs kernel_shape");
      }
      if (const auto* s = attribute("strides")) {
        if (s->ints.size() != 2) fail(type + " strides must be 2-D");
        op.stride_h = as_int(s->ints[0]), op.stride_w = as_int(s->ints[1]);
      }
      if (const auto* d = attribute("dilations")) {
        if (d->ints.size() != 2) fail(type + " dilations must be 2-D");
        op.dilation_h = as_int(d->ints[0]), op.dilation_w = as_int(d->ints[1]);
      }
      if (const auto* p = attribute("pads")) {
        if (p->ints.size() != 4) fail(type + " pads must be 2-D");
        // ONNX orders pads as begin (top, left) then end (bottom, right).
        for (int i = 0; i < 4; ++i) op.pads[std::size_t(i)] = as_int(p->ints[std::size_t(i)]);
      }
    };

    if (type == "Conv") {
      op.kind = Kind::conv;
      spatial(true);
      if (const auto* group = attribute("group")) op.groups = as_int(group->i);
      if (op.inputs.size() < 2) fail("Conv needs weights");
    } else if (type == "MaxPool") {
      op.kind = Kind::max_pool;
      spatial(false);
      if (const auto* ceil = attribute("ceil_mode"); ceil && ceil->i) fail("MaxPool ceil_mode is not supported");
      if (const auto* order = attribute("storage_order"); order && order->i) fail("MaxPool storage_order is not supported");
    } else if (type == "Relu") {
      op.kind = Kind::relu;
    } else if (type == "Sigmoid") {
      op.kind = Kind::sigmoid;
    } else if (type == "Add") {
      op.kind = Kind::add;
    } else if (type == "Mul") {
      op.kind = Kind::mul;
    } else if (type == "Transpose") {
      op.kind = Kind::transpose;
      const auto* perm = attribute("perm");
      if (!perm) fail("Transpose needs perm");
      for (const auto v : perm->ints) op.ints.push_back(as_int(v));
    } else if (type == "Reshape") {
      op.kind = Kind::reshape;
      if (op.inputs.size() != 2 || op.inputs[1] < 0 || !graph->values[std::size_t(op.inputs[1])].constant)
        fail("Reshape needs a constant shape");
      if (const auto* allow = attribute("allowzero"); allow && allow->i) fail("Reshape allowzero is not supported");
    } else if (type == "Resize") {
      op.kind = Kind::resize_nearest;
      const auto* mode = attribute("mode");
      const auto* transform = attribute("coordinate_transformation_mode");
      const auto* nearest = attribute("nearest_mode");
      if (!mode || mode->s != "nearest") fail("Resize supports nearest only");
      if (!transform || transform->s != "asymmetric") fail("Resize supports asymmetric coordinates only");
      if (nearest && nearest->s != "floor") fail("Resize supports floor rounding only");
      if (op.inputs.size() < 3 || op.inputs[2] < 0 || !graph->values[std::size_t(op.inputs[2])].constant)
        fail("Resize needs constant scales");
      if (op.inputs.size() > 3 && op.inputs[3] >= 0) fail("Resize sizes are not supported");
      const auto& scales = graph->values[std::size_t(op.inputs[2])].tensor.data;
      if (scales.size() != 4 || scales[0] != 1 || scales[1] != 1 || !(scales[2] > 0) || !(scales[3] > 0))
        fail("Resize scales must be spatial");
      op.scale_h = scales[2], op.scale_w = scales[3];
      op.inputs.resize(1);
    } else {
      fail("unsupported operator " + type);
    }
    graph->ops.push_back(std::move(op));
  }

  for (const auto& name : input_names) {
    const auto found = ids.find(name);
    // Older exports list initializers as inputs too; only real inputs count.
    if (found != ids.end() && graph->values[std::size_t(found->second)].constant) continue;
    graph->inputs.push_back(id_of(name));
  }
  for (const auto& name : output_names) {
    const auto found = ids.find(name);
    if (found == ids.end()) fail("output " + name + " is never produced");
    graph->outputs.push_back(found->second);
  }
  if (graph->inputs.empty() || graph->outputs.empty()) fail("graph has no inputs or outputs");
  graph->finalize();
  return Model(std::move(graph));
}

} // namespace lenslabs::nn
