# Opt-in native service packaging. The frozen decoder build is unchanged.
include v2.mk
HTTP_INCLUDE ?= build-v2/service-deps
.PHONY: service
service: $(V2_DIR)/v2-native
$(V2_DIR)/v2-native: service_v2/main.cpp $(PRIMITIVES) src/canonical_v2/decode.cpp include/lenslabs/canonical_v2.hpp canonical-v2.lock.json $(LIBS) $(HTTP_INCLUDE)/httplib.h | $(V2_DIR)
	$(CXX) $(FLAGS) $(INCLUDES) -I$(HTTP_INCLUDE) service_v2/main.cpp $(PRIMITIVES) src/canonical_v2/decode.cpp $(LIBS) -o $@
