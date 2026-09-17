CXX = clang++
BUILD_DIR ?= build
CXXFLAGS ?= -std=c++20 -O3 -DNDEBUG -Wall -Wextra -Wpedantic -pthread
CPPFLAGS += -Iinclude
LIBRAW_ROOT = build/deps/libraw-0.22.2
LIBRAW = $(LIBRAW_ROOT)/lib/libraw_r.a
CPPFLAGS += -I$(LIBRAW_ROOT)/include
FRAMEWORKS = -framework ImageIO -framework CoreGraphics -framework CoreFoundation
HEADERS = include/lenslabs/engine.hpp include/lenslabs/pipeline.hpp include/lenslabs/worker.hpp include/lenslabs/bursts.hpp include/lenslabs/develop.hpp
CORE = $(BUILD_DIR)/analysis.o
DECODER = $(BUILD_DIR)/decode_mac.o
PIPELINE = $(BUILD_DIR)/pipeline.o
WORKER = $(BUILD_DIR)/worker.o

.PHONY: all test sanitize
all: $(BUILD_DIR)/lenslabs-native $(BUILD_DIR)/lenslabs-bursts $(BUILD_DIR)/lenslabs-people $(BUILD_DIR)/lenslabs-social $(BUILD_DIR)/lenslabs-develop $(BUILD_DIR)/lenslabs-reference $(BUILD_DIR)/lenslabs-crop-suggest $(BUILD_DIR)/lenslabs-object-remove $(BUILD_DIR)/lenslabs-receipt $(BUILD_DIR)/lenslabs-gallery $(BUILD_DIR)/lenslabs-settings $(BUILD_DIR)/lenslabs-calendar

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(LIBRAW):
	@echo "Missing pinned LibRaw. Run: sh native/bootstrap-libraw.sh (from the repository root)" >&2
	@exit 1

$(BUILD_DIR)/decode_mac.o: $(LIBRAW)

$(BUILD_DIR)/%.o: src/%.cpp $(HEADERS) | $(BUILD_DIR)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -MMD -MP -c $< -o $@

$(BUILD_DIR)/lenslabs-native: $(BUILD_DIR)/main.o $(CORE) $(DECODER) $(PIPELINE) $(WORKER) $(LIBRAW)
	$(CXX) $(CXXFLAGS) $^ $(FRAMEWORKS) -o $@

$(BUILD_DIR)/core-tests: tests/core_tests.cpp $(CORE) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(CORE) -o $@

$(BUILD_DIR)/decoder-tests: tests/decoder_tests.cpp $(DECODER) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(DECODER) $(LIBRAW) $(FRAMEWORKS) -o $@

$(BUILD_DIR)/pipeline-tests: tests/pipeline_tests.cpp $(CORE) $(PIPELINE) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(CORE) $(PIPELINE) -o $@

$(BUILD_DIR)/worker-tests: tests/worker_tests.cpp $(CORE) $(DECODER) $(PIPELINE) $(WORKER) $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(CORE) $(DECODER) $(PIPELINE) $(WORKER) $(LIBRAW) $(FRAMEWORKS) -o $@

$(BUILD_DIR)/lenslabs-bursts: $(BUILD_DIR)/bursts_main.o $(BUILD_DIR)/bursts.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/burst-tests: tests/bursts_tests.cpp $(BUILD_DIR)/bursts.o $(HEADERS)
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/bursts.o -o $@

$(BUILD_DIR)/people.o $(BUILD_DIR)/people_main.o: include/lenslabs/people.hpp

$(BUILD_DIR)/lenslabs-people: $(BUILD_DIR)/people_main.o $(BUILD_DIR)/people.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/people-tests: tests/people_tests.cpp $(BUILD_DIR)/people.o include/lenslabs/people.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/people.o -o $@

$(BUILD_DIR)/lenslabs-social: $(BUILD_DIR)/social_main.o $(BUILD_DIR)/social.o $(DECODER) $(LIBRAW)
	$(CXX) $(CXXFLAGS) $^ $(FRAMEWORKS) -o $@

$(BUILD_DIR)/social-tests: tests/social_tests.cpp $(BUILD_DIR)/social.o include/lenslabs/social.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/social.o -o $@

$(BUILD_DIR)/lenslabs-develop: $(BUILD_DIR)/develop_main.o $(BUILD_DIR)/develop.o $(BUILD_DIR)/develop_raw.o $(DECODER) $(LIBRAW)
	$(CXX) $(CXXFLAGS) $^ $(FRAMEWORKS) -o $@

$(BUILD_DIR)/develop-auto-tests: tests/develop_auto_tests.cpp $(BUILD_DIR)/develop_auto.o $(BUILD_DIR)/develop.o include/lenslabs/develop_auto.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/develop_auto.o $(BUILD_DIR)/develop.o -o $@

$(BUILD_DIR)/voice-tests: tests/voice_tests.cpp $(BUILD_DIR)/voice.o include/lenslabs/voice.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/voice.o -o $@

$(BUILD_DIR)/develop_auto.o: include/lenslabs/develop_auto.hpp
$(BUILD_DIR)/voice.o: include/lenslabs/voice.hpp

$(BUILD_DIR)/develop-tests: tests/develop_tests.cpp $(BUILD_DIR)/develop.o include/lenslabs/develop.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/develop.o -o $@

$(BUILD_DIR)/reference.o $(BUILD_DIR)/reference_main.o: include/lenslabs/reference.hpp

$(BUILD_DIR)/lenslabs-reference: $(BUILD_DIR)/reference_main.o $(BUILD_DIR)/reference.o $(BUILD_DIR)/develop.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/reference-tests: tests/reference_tests.cpp $(BUILD_DIR)/reference.o $(BUILD_DIR)/develop.o include/lenslabs/reference.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/reference.o $(BUILD_DIR)/develop.o -o $@

$(BUILD_DIR)/crop_suggest.o $(BUILD_DIR)/crop_suggest_main.o: include/lenslabs/crop_suggest.hpp

$(BUILD_DIR)/lenslabs-crop-suggest: $(BUILD_DIR)/crop_suggest_main.o $(BUILD_DIR)/crop_suggest.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/crop-suggest-tests: tests/crop_suggest_tests.cpp $(BUILD_DIR)/crop_suggest.o include/lenslabs/crop_suggest.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/crop_suggest.o -o $@

$(BUILD_DIR)/object_remove.o: include/lenslabs/object_remove.hpp

$(BUILD_DIR)/receipt.o $(BUILD_DIR)/receipt_main.o: include/lenslabs/receipt.hpp

$(BUILD_DIR)/lenslabs-receipt: $(BUILD_DIR)/receipt_main.o $(BUILD_DIR)/receipt.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/receipt-tests: tests/receipt_tests.cpp $(BUILD_DIR)/receipt.o include/lenslabs/receipt.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/receipt.o -o $@

$(BUILD_DIR)/gallery.o $(BUILD_DIR)/gallery_main.o: include/lenslabs/gallery.hpp

$(BUILD_DIR)/lenslabs-gallery: $(BUILD_DIR)/gallery_main.o $(BUILD_DIR)/gallery.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/gallery-tests: tests/gallery_tests.cpp $(BUILD_DIR)/gallery.o include/lenslabs/gallery.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/gallery.o -o $@

$(BUILD_DIR)/settings.o $(BUILD_DIR)/settings_main.o: include/lenslabs/settings.hpp

$(BUILD_DIR)/lenslabs-settings: $(BUILD_DIR)/settings_main.o $(BUILD_DIR)/settings.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/settings-tests: tests/settings_tests.cpp $(BUILD_DIR)/settings.o include/lenslabs/settings.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/settings.o -o $@

$(BUILD_DIR)/calendar.o $(BUILD_DIR)/calendar_main.o: include/lenslabs/calendar.hpp

$(BUILD_DIR)/lenslabs-calendar: $(BUILD_DIR)/calendar_main.o $(BUILD_DIR)/calendar.o
	$(CXX) $(CXXFLAGS) $^ -o $@

$(BUILD_DIR)/calendar-tests: tests/calendar_tests.cpp $(BUILD_DIR)/calendar.o include/lenslabs/calendar.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< $(BUILD_DIR)/calendar.o -o $@

$(BUILD_DIR)/lenslabs-object-remove: src/object_remove_main.mm $(BUILD_DIR)/object_remove.o include/lenslabs/object_remove.hpp
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) -fobjc-arc $< $(BUILD_DIR)/object_remove.o $(FRAMEWORKS) -framework Foundation -framework Vision -framework CoreVideo -o $@

test: $(BUILD_DIR)/core-tests $(BUILD_DIR)/decoder-tests $(BUILD_DIR)/pipeline-tests $(BUILD_DIR)/worker-tests $(BUILD_DIR)/burst-tests $(BUILD_DIR)/people-tests $(BUILD_DIR)/social-tests $(BUILD_DIR)/develop-tests $(BUILD_DIR)/reference-tests $(BUILD_DIR)/crop-suggest-tests $(BUILD_DIR)/receipt-tests $(BUILD_DIR)/gallery-tests $(BUILD_DIR)/settings-tests $(BUILD_DIR)/calendar-tests $(BUILD_DIR)/develop-auto-tests $(BUILD_DIR)/voice-tests
	$(BUILD_DIR)/core-tests
	$(BUILD_DIR)/decoder-tests ../tests/fixtures/photos
	$(BUILD_DIR)/pipeline-tests
	$(BUILD_DIR)/worker-tests ../tests/fixtures/photos
	$(BUILD_DIR)/burst-tests
	$(BUILD_DIR)/people-tests
	$(BUILD_DIR)/social-tests
	$(BUILD_DIR)/develop-tests
	$(BUILD_DIR)/reference-tests
	$(BUILD_DIR)/crop-suggest-tests
	$(BUILD_DIR)/receipt-tests
	$(BUILD_DIR)/gallery-tests
	$(BUILD_DIR)/settings-tests
	$(BUILD_DIR)/calendar-tests
	$(BUILD_DIR)/develop-auto-tests
	$(BUILD_DIR)/voice-tests

sanitize:
	$(MAKE) BUILD_DIR=build-sanitize CXXFLAGS="-std=c++20 -O1 -g -Wall -Wextra -Wpedantic -pthread -fsanitize=address,undefined -fno-omit-frame-pointer" test

-include $(wildcard $(BUILD_DIR)/*.d)
