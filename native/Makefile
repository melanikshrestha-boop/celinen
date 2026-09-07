CXX = clang++
BUILD_DIR ?= build
CXXFLAGS ?= -std=c++20 -O3 -DNDEBUG -Wall -Wextra -Wpedantic -pthread
CPPFLAGS += -Iinclude
FRAMEWORKS = -framework ImageIO -framework CoreGraphics -framework CoreFoundation
HEADERS = include/lenslabs/engine.hpp include/lenslabs/pipeline.hpp include/lenslabs/worker.hpp include/lenslabs/bursts.hpp
CORE = $(BUILD_DIR)/analysis.o
DECODER = $(BUILD_DIR)/decode_mac.o
PIPELINE = $(BUILD_DIR)/pipeline.o
WORKER = $(BUILD_DIR)/worker.o

.PHONY: all test sanitize
all: $(BUILD_DIR)/lenslabs-native $(BUILD_DIR)/lenslabs-bursts

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/%.o: src/%.cpp $(HEADERS) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -MMD -MP -c $< -o $@

$(BUILD_DIR)/lenslabs-native: $(BUILD_DIR)/main.o $(CORE) $(DECODER) $(PIPELINE) $(WORKER)
	$(CXX) $(CXXFLAGS) $^ $(FRAMEWORKS) -o $@

$(BUILD_DIR)/core-tests: tests/core_tests.cpp $(CORE) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(CORE) -o $@

$(BUILD_DIR)/decoder-tests: tests/decoder_tests.cpp $(DECODER) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(DECODER) $(FRAMEWORKS) -o $@

$(BUILD_DIR)/pipeline-tests: tests/pipeline_tests.cpp $(CORE) $(PIPELINE) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(CORE) $(PIPELINE) -o $@

$(BUILD_DIR)/worker-tests: tests/worker_tests.cpp $(CORE) $(DECODER) $(PIPELINE) $(WORKER) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(CORE) $(DECODER) $(PIPELINE) $(WORKER) $(FRAMEWORKS) -o $@

$(BUILD_DIR)/lenslabs-bursts: $(BUILD_DIR)/bursts_main.o $(BUILD_DIR)/bursts.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/burst-tests: tests/bursts_tests.cpp $(BUILD_DIR)/bursts.o $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/bursts.o -o $@

test: $(BUILD_DIR)/core-tests $(BUILD_DIR)/decoder-tests $(BUILD_DIR)/pipeline-tests $(BUILD_DIR)/worker-tests $(BUILD_DIR)/burst-tests
	$(BUILD_DIR)/core-tests
	$(BUILD_DIR)/decoder-tests ../tests/fixtures/photos
	$(BUILD_DIR)/pipeline-tests
	$(BUILD_DIR)/worker-tests ../tests/fixtures/photos
	$(BUILD_DIR)/burst-tests

sanitize:
	$(MAKE) BUILD_DIR=build-sanitize CXXFLAGS="-std=c++20 -O1 -g -Wall -Wextra -Wpedantic -pthread -fsanitize=address,undefined -fno-omit-frame-pointer" test

-include $(wildcard $(BUILD_DIR)/*.d)
