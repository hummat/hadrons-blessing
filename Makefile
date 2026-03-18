# Read GROUND_TRUTH_SOURCE_ROOT from env, falling back to .source-root file.
# Create .source-root once: echo /path/to/Darktide-Source-Code > .source-root
GROUND_TRUTH_SOURCE_ROOT ?= $(shell cat .source-root 2>/dev/null)

.PHONY: require-source-root test resolve audit index-build index-check edges-build effects-build breeds-build profiles-build check

require-source-root:
	@if [ -z "$(GROUND_TRUTH_SOURCE_ROOT)" ]; then \
		echo "GROUND_TRUTH_SOURCE_ROOT is required."; \
		echo "Set it via env var or: echo /path/to/Darktide-Source-Code > .source-root"; \
		exit 1; \
	fi

test: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm test

resolve:
	npm run resolve -- $(ARGS)

audit: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run audit -- $(ARGS)

index-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run index:build

index-check: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run index:check

edges-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run edges:build

effects-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run effects:build

breeds-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run breeds:build

profiles-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run profiles:build

check: require-source-root edges-build effects-build breeds-build profiles-build
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run check
