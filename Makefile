.PHONY: require-source-root test resolve audit index-build index-check check

require-source-root:
	@if [ -z "$(GROUND_TRUTH_SOURCE_ROOT)" ]; then \
		echo "GROUND_TRUTH_SOURCE_ROOT is required."; \
		echo "Example: GROUND_TRUTH_SOURCE_ROOT=/path/to/Darktide-Source-Code make check"; \
		exit 1; \
	fi

test: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm test

resolve:
	npm run resolve -- $(ARGS)

audit:
	npm run audit -- $(ARGS)

index-build: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run index:build

index-check: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run index:check

check: require-source-root
	GROUND_TRUTH_SOURCE_ROOT="$(GROUND_TRUTH_SOURCE_ROOT)" npm run check
