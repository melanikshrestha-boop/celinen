#include "lenslabs/people.hpp"

#include <cmath>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {
unsigned checks = 0, failures = 0;
void check(bool value, const char* expression, int line) {
  ++checks;
  if (!value) {
    ++failures;
    std::cerr << "FAIL line " << line << ": " << expression << '\n';
  }
}
#define CHECK(expression) check(static_cast<bool>(expression), #expression, __LINE__)
template <typename Function>
void invalid(Function fn) {
  ++checks;
  try {
    fn();
    ++failures;
    std::cerr << "Expected invalid_argument\n";
  } catch (const std::invalid_argument&) {
  } catch (...) {
    ++failures;
    std::cerr << "Wrong exception type\n";
  }
}

std::string embed_hex(const std::vector<float>& values) {
  std::vector<float> padded(lenslabs::insightface_embedding_dim, 0.f);
  for (std::size_t i = 0; i < values.size() && i < padded.size(); ++i) padded[i] = values[i];
  std::string out(4096, '0');
  static const char* digits = "0123456789abcdef";
  for (std::size_t i = 0; i < padded.size(); ++i) {
    std::uint32_t bits = 0;
    std::memcpy(&bits, &padded[i], sizeof(bits));
    for (int b = 0; b < 4; ++b) {
      const unsigned byte = (bits >> (8 * b)) & 0xff;
      out[i * 8 + b * 2] = digits[byte >> 4];
      out[i * 8 + b * 2 + 1] = digits[byte & 0xf];
    }
  }
  return out;
}

std::string hex_id(std::string_view text) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  out.resize(text.size() * 2);
  for (std::size_t i = 0; i < text.size(); ++i) {
    const auto value = static_cast<unsigned char>(text[i]);
    out[i * 2] = digits[value >> 4];
    out[i * 2 + 1] = digits[value & 0xf];
  }
  return out;
}

lenslabs::FaceObservation face(std::string id, std::string frame, std::vector<float> values,
                               std::string source = "insightface") {
  lenslabs::FaceObservation out;
  out.id = std::move(id);
  out.frame_id = std::move(frame);
  out.source = std::move(source);
  out.det_score = 0.9;
  out.embedding.assign(lenslabs::insightface_embedding_dim, 0.f);
  for (std::size_t i = 0; i < values.size() && i < out.embedding.size(); ++i) out.embedding[i] = values[i];
  return out;
}

std::vector<lenslabs::FaceObservation> parse(const std::string& input) {
  std::istringstream stream(input);
  return lenslabs::read_people_protocol(stream);
}
} // namespace

int main() {
  using namespace lenslabs;

  std::vector<float> unit(insightface_embedding_dim, 0.f);
  unit[0] = 1;
  CHECK(l2_normalize(unit.data()));
  CHECK(std::fabs(unit[0] - 1) < 1e-6);

  auto a = face("a", "frame-a", {1, 0});
  auto same = face("b", "frame-b", {0.99f, 0.01f});
  auto other = face("c", "frame-c", {0, 1});
  auto review = cluster_people({a, same, other});
  CHECK(review.clusters.size() == 2);
  CHECK(review.clustered_observations == 3);
  CHECK(review.unresolved_observations == 0);
  CHECK(review.embedding_source == "insightface");
  bool found_pair = false;
  for (const auto& cluster : review.clusters) {
    CHECK(cluster.id.find("person-") == 0);
    CHECK(cluster.id.find(' ') == std::string::npos);
    if (cluster.observation_ids.size() == 2) {
      found_pair = true;
      CHECK(cluster.confidence == "matched");
      CHECK(cluster.source == "insightface");
    }
  }
  CHECK(found_pair);

  auto zero = face("z", "frame-z", {});
  review = cluster_people({zero});
  CHECK(review.clusters.empty());
  CHECK(review.unresolved_ids == std::vector<std::string>{"z"});

  auto local_a = face("la", "f1", {1, 0}, "local-descriptor");
  auto local_b = face("lb", "f2", {0, 1}, "local-descriptor");
  review = cluster_people({local_a, local_b});
  CHECK(review.clusters.size() == 2);
  CHECK(review.embedding_source == "local-descriptor");
  auto local_c = face("lc", "f3", {0.99f, 0.01f}, "local-descriptor");
  CHECK(cluster_people({local_a, local_c}).clusters.size() == 1);

  auto mixed = cluster_people({a, local_a});
  CHECK(mixed.clusters.size() == 2);
  CHECK(mixed.embedding_source == "mixed");
  CHECK(mixed.clusters[0].source != mixed.clusters[1].source);

  invalid([] { cluster_people({face("a", "f", {1}, "buffalo")}); });
  auto dup = a;
  dup.id = "a";
  invalid([&] { cluster_people({a, dup}); });
  auto bad_dim = a;
  bad_dim.embedding.resize(128);
  invalid([&] { cluster_people({bad_dim}); });

  const auto json = people_review_json(cluster_people({a, same}));
  CHECK(json.find("\"id\":\"person-1\"") != std::string::npos);
  CHECK(json.find("not-shipped") != std::string::npos);
  CHECK(json.find("never auto-downloads") != std::string::npos);
  CHECK(json.find("Jane") == std::string::npos);
  CHECK(json.find("father") == std::string::npos);

  const auto protocol = std::string("LENSPPL1 2\n") + hex_id("obs-a") + " " + hex_id("frame-a") +
                        " insightface 0.91 " + embed_hex({1, 0}) + "\n" + hex_id("obs-b") + " " +
                        hex_id("frame-b") + " insightface 0.88 " + embed_hex({0.99f, 0.01f}) + "\n";
  const auto parsed = parse(protocol);
  CHECK(parsed.size() == 2);
  CHECK(parsed[0].id == "obs-a");
  CHECK(cluster_people(parsed).clusters.size() == 1);

  invalid([] {
    parse("LENSBURST1 0\n");
  });
  invalid([] { parse("LENSPPL1 1\n"); });

  auto empty_pack = inspect_insightface_pack({});
  CHECK(!empty_pack.complete());
  const auto tmp = std::filesystem::temp_directory_path() / "lenslabs-insightface-test";
  std::filesystem::create_directories(tmp);
  auto missing = inspect_insightface_pack(tmp);
  CHECK(!missing.detector && !missing.recognizer);
  {
    std::ofstream(tmp / "det_10g.onnx") << "placeholder";
    std::ofstream(tmp / "w600k_r50.onnx") << "placeholder";
  }
  auto present = inspect_insightface_pack(tmp);
  CHECK(present.complete());
  std::filesystem::remove_all(tmp);

  std::cerr << checks << " checks, " << failures << " failures\n";
  return failures ? 1 : 0;
}
