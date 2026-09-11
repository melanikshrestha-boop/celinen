#include "lenslabs/people.hpp"

#include <algorithm>
#include <array>
#include <charconv>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <locale>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <unordered_set>
#include <utility>

namespace lenslabs {
namespace {

constexpr std::size_t max_observations = 20000;
constexpr std::size_t embed_bytes = insightface_embedding_dim * sizeof(float);
constexpr std::size_t embed_hex_len = embed_bytes * 2;

bool valid_utf8(std::string_view text) {
  for (std::size_t i = 0; i < text.size();) {
    const auto lead = static_cast<unsigned char>(text[i++]);
    if (lead < 0x80) {
      if (lead < 0x20 || lead == 0x7f) return false;
      continue;
    }
    unsigned count = 0;
    std::uint32_t value = 0;
    std::uint32_t minimum = 0;
    if (lead >= 0xc2 && lead <= 0xdf) {
      count = 1;
      value = lead & 0x1f;
      minimum = 0x80;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      count = 2;
      value = lead & 0x0f;
      minimum = 0x800;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      count = 3;
      value = lead & 0x07;
      minimum = 0x10000;
    } else {
      return false;
    }
    if (i + count > text.size()) return false;
    while (count--) {
      const auto next = static_cast<unsigned char>(text[i++]);
      if ((next & 0xc0) != 0x80) return false;
      value = (value << 6) | (next & 0x3f);
    }
    if (value < minimum || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return false;
  }
  return true;
}

void validate(const FaceObservation& face) {
  if (face.id.empty() || face.id.size() > 512 || !valid_utf8(face.id) ||
      face.frame_id.empty() || face.frame_id.size() > 512 || !valid_utf8(face.frame_id)) {
    throw std::invalid_argument("Invalid face observation identity");
  }
  if (face.source != "insightface" && face.source != "local-descriptor") {
    throw std::invalid_argument("Unknown embedding source");
  }
  if (!std::isfinite(face.det_score) || face.det_score < 0 || face.det_score > 1) {
    throw std::invalid_argument("Invalid detection score");
  }
  if (face.embedding.size() != insightface_embedding_dim) {
    throw std::invalid_argument("InsightFace embeddings are 512-d");
  }
  for (const auto value : face.embedding) {
    if (!std::isfinite(value)) throw std::invalid_argument("Non-finite embedding");
  }
}

std::string quote(std::string_view text) {
  std::string out = "\"";
  for (const auto value : text) {
    if (value == '\\' || value == '"') out += '\\';
    out += value;
  }
  return out + '"';
}

std::string read_line(std::istream& input) {
  std::string line;
  line.reserve(512);
  char c;
  while (input.get(c)) {
    if (c == '\n') return line;
    if (line.size() >= 20000) throw std::invalid_argument("People protocol line too large");
    line += c;
  }
  if (!line.empty()) return line;
  throw std::invalid_argument("Incomplete people protocol");
}

std::string unhex(const std::string& text, std::size_t limit, bool optional) {
  if (optional && text == "-") return {};
  if (text.empty() || text.size() % 2 || text.size() / 2 > limit) {
    throw std::invalid_argument("Invalid people identity encoding");
  }
  auto nibble = [](char c) -> unsigned {
    if (c >= '0' && c <= '9') return static_cast<unsigned>(c - '0');
    if (c >= 'a' && c <= 'f') return static_cast<unsigned>(c - 'a' + 10);
    if (c >= 'A' && c <= 'F') return static_cast<unsigned>(c - 'A' + 10);
    throw std::invalid_argument("Invalid hexadecimal input");
  };
  std::string out;
  out.reserve(text.size() / 2);
  for (std::size_t i = 0; i < text.size(); i += 2) {
    out += static_cast<char>((nibble(text[i]) << 4) | nibble(text[i + 1]));
  }
  return out;
}

template <typename T>
T integer(const std::string& value, int base = 10) {
  T result{};
  auto parsed = std::from_chars(value.data(), value.data() + value.size(), result, base);
  if (parsed.ec != std::errc{} || parsed.ptr != value.data() + value.size()) {
    throw std::invalid_argument("Invalid protocol integer");
  }
  return result;
}

double decimal(const std::string& value) {
  std::istringstream stream(value);
  stream.imbue(std::locale::classic());
  double result = 0;
  if (!(stream >> result) || !stream.eof() || !std::isfinite(result)) {
    throw std::invalid_argument("Invalid protocol number");
  }
  return result;
}

std::vector<float> decode_embedding(const std::string& hex) {
  if (hex.size() != embed_hex_len) throw std::invalid_argument("Invalid embedding encoding");
  auto nibble = [](char c) -> unsigned {
    if (c >= '0' && c <= '9') return static_cast<unsigned>(c - '0');
    if (c >= 'a' && c <= 'f') return static_cast<unsigned>(c - 'a' + 10);
    if (c >= 'A' && c <= 'F') return static_cast<unsigned>(c - 'A' + 10);
    throw std::invalid_argument("Invalid embedding hex");
  };
  std::vector<std::uint8_t> bytes(embed_bytes);
  for (std::size_t i = 0; i < embed_bytes; ++i) {
    bytes[i] = static_cast<std::uint8_t>((nibble(hex[i * 2]) << 4) | nibble(hex[i * 2 + 1]));
  }
  std::vector<float> out(insightface_embedding_dim);
  for (std::size_t i = 0; i < insightface_embedding_dim; ++i) {
    const std::uint32_t bits = static_cast<std::uint32_t>(bytes[i * 4]) |
                               (static_cast<std::uint32_t>(bytes[i * 4 + 1]) << 8) |
                               (static_cast<std::uint32_t>(bytes[i * 4 + 2]) << 16) |
                               (static_cast<std::uint32_t>(bytes[i * 4 + 3]) << 24);
    float value = 0;
    std::memcpy(&value, &bits, sizeof(value));
    out[i] = value;
  }
  return out;
}

float match_threshold(std::string_view source) {
  return source == "insightface" ? insightface_match_threshold : local_descriptor_match_threshold;
}

struct WorkingCluster {
  std::vector<std::size_t> members;
  std::array<double, insightface_embedding_dim> sum{};
  std::array<float, insightface_embedding_dim> centroid{};
  std::string source;
  double min_similarity = 1;
};

void refresh_centroid(WorkingCluster& cluster) {
  double norm = 0;
  for (std::size_t i = 0; i < insightface_embedding_dim; ++i) {
    const double value = cluster.sum[i];
    norm += value * value;
  }
  const double scale = norm > 1e-12 ? 1.0 / std::sqrt(norm) : 0;
  for (std::size_t i = 0; i < insightface_embedding_dim; ++i) {
    cluster.centroid[i] = static_cast<float>(cluster.sum[i] * scale);
  }
}

} // namespace

float cosine_similarity(const float* a, const float* b, std::size_t dim) {
  double dot = 0;
  for (std::size_t i = 0; i < dim; ++i) dot += static_cast<double>(a[i]) * static_cast<double>(b[i]);
  if (!std::isfinite(dot)) return 0;
  return static_cast<float>(std::max(-1.0, std::min(1.0, dot)));
}

bool l2_normalize(float* values, std::size_t dim) {
  double norm = 0;
  for (std::size_t i = 0; i < dim; ++i) {
    const double value = values[i];
    if (!std::isfinite(value)) return false;
    norm += value * value;
  }
  if (norm < 1e-12) return false;
  const float scale = static_cast<float>(1.0 / std::sqrt(norm));
  for (std::size_t i = 0; i < dim; ++i) values[i] *= scale;
  return true;
}

InsightFacePack inspect_insightface_pack(const std::filesystem::path& dir) {
  InsightFacePack pack;
  pack.dir = dir.empty() ? "" : dir.string();
  if (dir.empty()) return pack;
  std::error_code ec;
  if (!std::filesystem::is_directory(dir, ec)) return pack;
  pack.detector = std::filesystem::is_regular_file(dir / "det_10g.onnx", ec);
  pack.recognizer = std::filesystem::is_regular_file(dir / "w600k_r50.onnx", ec);
  return pack;
}

PeopleReview cluster_people(const std::vector<FaceObservation>& faces) {
  if (faces.size() > max_observations) {
    throw std::invalid_argument("At most 20000 face observations are supported");
  }
  PeopleReview result;
  result.input_observations = faces.size();
  std::unordered_set<std::string> ids;
  std::vector<FaceObservation> usable;
  usable.reserve(faces.size());
  std::string source;
  bool mixed = false;
  for (const auto& face : faces) {
    validate(face);
    if (!ids.insert(face.id).second) throw std::invalid_argument("Duplicate face observation identity");
    FaceObservation copy = face;
    if (!l2_normalize(copy.embedding.data())) {
      result.unresolved_ids.push_back(face.id);
      continue;
    }
    if (source.empty()) source = copy.source;
    else if (source != copy.source) mixed = true;
    usable.push_back(std::move(copy));
  }
  result.embedding_source = mixed ? "mixed" : (source.empty() ? "none" : source);
  result.unresolved_observations = result.unresolved_ids.size();

  std::sort(usable.begin(), usable.end(), [](const FaceObservation& a, const FaceObservation& b) {
    return a.id < b.id;
  });

  std::vector<WorkingCluster> clusters;
  for (std::size_t i = 0; i < usable.size(); ++i) {
    const auto& face = usable[i];
    std::size_t best = clusters.size();
    float best_sim = -1;
    for (std::size_t c = 0; c < clusters.size(); ++c) {
      if (clusters[c].source != face.source) continue;
      ++result.comparisons;
      const auto sim = cosine_similarity(face.embedding.data(), clusters[c].centroid.data());
      if (sim > best_sim) {
        best_sim = sim;
        best = c;
      }
    }
    if (best < clusters.size() && best_sim >= match_threshold(face.source)) {
      auto& cluster = clusters[best];
      cluster.members.push_back(i);
      cluster.min_similarity = std::min(cluster.min_similarity, static_cast<double>(best_sim));
      for (std::size_t d = 0; d < insightface_embedding_dim; ++d) {
        cluster.sum[d] += face.embedding[d];
      }
      refresh_centroid(cluster);
    } else {
      WorkingCluster cluster;
      cluster.source = face.source;
      cluster.members.push_back(i);
      for (std::size_t d = 0; d < insightface_embedding_dim; ++d) {
        cluster.sum[d] = face.embedding[d];
        cluster.centroid[d] = face.embedding[d];
      }
      clusters.push_back(std::move(cluster));
    }
  }

  result.clusters.reserve(clusters.size());
  for (std::size_t c = 0; c < clusters.size(); ++c) {
    PersonCluster person;
    person.id = "person-" + std::to_string(c + 1);
    person.source = clusters[c].source;
    person.min_similarity = clusters[c].members.size() == 1 ? 1 : clusters[c].min_similarity;
    person.confidence = clusters[c].members.size() >= 2 ? "matched" : "singleton";
    std::unordered_set<std::string> frames;
    for (const auto index : clusters[c].members) {
      person.observation_ids.push_back(usable[index].id);
      if (frames.insert(usable[index].frame_id).second) {
        person.frame_ids.push_back(usable[index].frame_id);
      }
    }
    result.clustered_observations += person.observation_ids.size();
    result.clusters.push_back(std::move(person));
  }
  return result;
}

std::vector<FaceObservation> read_people_protocol(std::istream& input) {
  std::istringstream header(read_line(input));
  std::string magic, count_text, extra;
  if (!(header >> magic >> count_text) || (header >> extra) || magic != "LENSPPL1") {
    throw std::invalid_argument("Invalid people protocol header");
  }
  const auto count = integer<std::size_t>(count_text);
  if (count > max_observations) throw std::invalid_argument("At most 20000 face observations are supported");
  std::vector<FaceObservation> faces;
  faces.reserve(count);
  std::size_t total_bytes = 0;
  for (std::size_t i = 0; i < count; ++i) {
    auto text = read_line(input);
    total_bytes += text.size();
    if (total_bytes > 64 * 1024 * 1024) throw std::invalid_argument("People request exceeds 64 MiB");
    std::istringstream line(text);
    std::string id, frame, source, score, embedding;
    if (!(line >> id >> frame >> source >> score >> embedding) || (line >> extra)) {
      throw std::invalid_argument("Invalid people protocol row");
    }
    FaceObservation face;
    face.id = unhex(id, 512, false);
    face.frame_id = unhex(frame, 512, false);
    face.source = source;
    face.det_score = decimal(score);
    face.embedding = decode_embedding(embedding);
    validate(face);
    faces.push_back(std::move(face));
  }
  char remaining;
  while (input.get(remaining)) {
    if (remaining != '\r' && remaining != '\n' && remaining != ' ' && remaining != '\t') {
      throw std::invalid_argument("Unexpected trailing people input");
    }
    if (++total_bytes > 64 * 1024 * 1024) throw std::invalid_argument("People request exceeds 64 MiB");
  }
  return faces;
}

std::string people_review_json(const PeopleReview& review) {
  std::ostringstream out;
  out.imbue(std::locale::classic());
  out << std::setprecision(6);
  out << "{\"clusters\":[";
  bool comma = false;
  for (const auto& cluster : review.clusters) {
    if (comma) out << ',';
    comma = true;
    out << "{\"id\":" << quote(cluster.id) << ",\"observationIds\":[";
    for (std::size_t i = 0; i < cluster.observation_ids.size(); ++i) {
      if (i) out << ',';
      out << quote(cluster.observation_ids[i]);
    }
    out << "],\"frameIds\":[";
    for (std::size_t i = 0; i < cluster.frame_ids.size(); ++i) {
      if (i) out << ',';
      out << quote(cluster.frame_ids[i]);
    }
    out << "],\"source\":" << quote(cluster.source) << ",\"minSimilarity\":" << cluster.min_similarity
        << ",\"confidence\":" << quote(cluster.confidence) << "}";
  }
  out << "],\"unresolvedIds\":[";
  for (std::size_t i = 0; i < review.unresolved_ids.size(); ++i) {
    if (i) out << ',';
    out << quote(review.unresolved_ids[i]);
  }
  out << "],\"stats\":{\"inputObservations\":" << review.input_observations
      << ",\"clusteredObservations\":" << review.clustered_observations
      << ",\"unresolvedObservations\":" << review.unresolved_observations
      << ",\"comparisons\":" << review.comparisons
      << ",\"embeddingSource\":" << quote(review.embedding_source)
      << "},\"license\":{\"code\":\"MIT\",\"weights\":\"not-shipped\","
      << "\"note\":\"InsightFace code is MIT. buffalo_* and antelopev2 pretrained weights are "
         "non-commercial research unless separately licensed. FOTO never auto-downloads them.\"}}";
  return out.str();
}

} // namespace lenslabs
