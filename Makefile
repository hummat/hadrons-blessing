# Read GROUND_TRUTH_SOURCE_ROOT from env, falling back to .source-root file.
# Create .source-root once: echo /path/to/Darktide-Source-Code > .source-root
GROUND_TRUTH_SOURCE_ROOT ?= $(shell cat .source-root 2>/dev/null)

.PHONY: require-source-root build test resolve audit class-side-build index-build index-check edges-build effects-build breeds-build profiles-build stagger-build check

require-source-root:
	@if [ -z "$(GROUND_TRUTH_SOURCE_ROOT)" ]; then \
		echo "GROUND_TRUTH_SOURCE_ROOT is required."; \
		echo "Set it via env var or: echo /path/to/Darktide-Source-Code > .source-root"; \
		exit 1; \
	fi

build:
	npm run build

test: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm test

resolve:
	npm run resolve -- $(ARGS)

audit: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run audit -- $(ARGS)

class-side-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run class-side:build

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

stagger-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run stagger:build

check: require-source-root build class-side-build edges-build effects-build breeds-build profiles-build stagger-build
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run check

# Website
.PHONY: website-data website-build website-dev website-preview website-smoke

website-data: build
	cd website && npx tsx scripts/generate-data.ts

website-build: website-data
	cd website && npm run build

website-dev:
	cd website && npm run dev

website-preview:
	cd website && npm run preview -- --host "$${HB_WEBSITE_HOST:-127.0.0.1}" --port "$${HB_WEBSITE_PORT:-4173}"

website-smoke:
	./scripts/website-smoke.sh $(ARGS)
