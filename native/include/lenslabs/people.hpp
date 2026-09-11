#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <istream>
#include <string>
#include <vector>

namespace lenslabs {

inline constexpr std::size_t insightface_embedding_dim = 512;
// InsightFace ArcFace (buffalo_l / antelopev2) typically matches around cosine 0.5
// on L2-normalized 512-d features. Keep this conservative so two people are not
// merged. Local HOG descriptors are a different space and use a higher bar.
inline constexpr float insightface_match_threshold = 0.50f;
inline constexpr float local_descriptor_match_threshold = 0.68f;

struct FaceObservation {
  std::string id;
  std::string frame_id;
  std::string source; // "insightface" or "local-descriptor"
  double det_score = 0;
  std::vector<float> embedding;
};

struct PersonCluster {
  std::string id; // event-local "person-12". Never a name.
  std::vector<std::string> observation_ids;
  std::vector<std::string> frame_ids;
  std::string source;
  double min_similarity = 1;
  std::string confidence; // "matched" (2+ faces) or "singleton"
};

struct PeopleReview {
  std::vector<PersonCluster> clusters;
  std::vector<std::string> unresolved_ids;
  std::size_t input_observations = 0;
  std::size_t clustered_observations = 0;
  std::size_t unresolved_observations = 0;
  std::size_t comparisons = 0;
  std::string embedding_source;
};

struct InsightFacePack {
  std::string dir;
  bool detector = false;   // det_10g.onnx
  bool recognizer = false; // w600k_r50.onnx
  bool complete() const noexcept { return detector && recognizer; }
};

// Event-local clustering of InsightFace-style 512-d embeddings. Does not name
// people, does not infer family roles, and does not load buffalo_* weights.
PeopleReview cluster_people(const std::vector<FaceObservation>& faces);
std::vector<FaceObservation> read_people_protocol(std::istream& input);
std::string people_review_json(const PeopleReview& review);
float cosine_similarity(const float* a, const float* b, std::size_t dim = insightface_embedding_dim);
bool l2_normalize(float* values, std::size_t dim = insightface_embedding_dim);
InsightFacePack inspect_insightface_pack(const std::filesystem::path& dir);

} // namespace lenslabs
