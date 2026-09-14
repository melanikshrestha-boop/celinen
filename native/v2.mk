# Invoked explicitly with make -C native -f v2.mk. No existing Makefile changes.
CXX = clang++
V2_DIR ?= build-v2
V2_DEPS_ROOT ?= build-v2
DEPS = $(V2_DEPS_ROOT)/deps
FLAGS ?= -std=c++20 -O2 -g -Wall -Wextra -Wpedantic -Werror -fno-fast-math -ffp-contract=off -pthread
ifeq ($(shell uname -s),Darwin)
override FLAGS += -mmacosx-version-min=14.3
endif
INCLUDES = -Iinclude -I$(V2_DEPS_ROOT)/prefix/include -I$(DEPS)/LibRaw-0.22.2
INCLUDES += -DV2_CONTRACT_SHA=\"$(shell shasum -a 256 canonical-v2.lock.json | cut -d ' ' -f 1)\"
PRIMITIVES = src/canonical_v2/primitives.cpp src/canonical_v2/sha256.cpp src/canonical_v2/source.cpp
LIBS = $(V2_DEPS_ROOT)/prefix/lib/libjpeg.a $(V2_DEPS_ROOT)/prefix/lib/liblcms2.a $(DEPS)/LibRaw-0.22.2/lib/libraw_r.a
.PHONY: all test sanitize
all: $(V2_DIR)/v2-probe $(V2_DIR)/v2-tests $(V2_DIR)/v2-decoder-tests
$(V2_DIR):
	mkdir -p $@
$(V2_DIR)/v2-tests: tests/canonical_v2_tests.cpp $(PRIMITIVES) include/lenslabs/canonical_v2.hpp | $(V2_DIR)
	$(CXX) $(FLAGS) -Iinclude tests/canonical_v2_tests.cpp $(PRIMITIVES) -o $@
$(V2_DIR)/v2-probe: tests/canonical_v2_probe.cpp $(PRIMITIVES) src/canonical_v2/decode.cpp include/lenslabs/canonical_v2.hpp canonical-v2.lock.json $(LIBS) | $(V2_DIR)
	$(CXX) $(FLAGS) $(INCLUDES) tests/canonical_v2_probe.cpp $(PRIMITIVES) src/canonical_v2/decode.cpp $(LIBS) -o $@
test: $(V2_DIR)/v2-tests
	$(V2_DIR)/v2-tests
$(V2_DIR)/v2-decoder-tests: tests/canonical_v2_decoder_tests.cpp $(PRIMITIVES) src/canonical_v2/decode.cpp include/lenslabs/canonical_v2.hpp canonical-v2.lock.json $(LIBS) | $(V2_DIR)
	$(CXX) $(FLAGS) $(INCLUDES) tests/canonical_v2_decoder_tests.cpp $(PRIMITIVES) src/canonical_v2/decode.cpp $(LIBS) -o $@
decoder-test: $(V2_DIR)/v2-decoder-tests
	$(V2_DIR)/v2-decoder-tests build-v2/downloads/sRGB2014.icc
sanitize:
	$(MAKE) -f v2.mk V2_DIR=build-v2/sanitize FLAGS="-std=c++20 -O1 -g -Wall -Wextra -Wpedantic -Werror -pthread -fno-fast-math -ffp-contract=off -fsanitize=address,undefined -fno-omit-frame-pointer" all
	build-v2/sanitize/v2-tests
