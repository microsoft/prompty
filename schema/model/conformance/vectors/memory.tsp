import "@typra/emitter";

namespace Prompty.Conformance.Vectors;

// Memory vectors are authored as JSON strings so expected scores and ordered
// result slices stay explicit. These vectors own observable memory behavior:
// deterministic recall, formatting, mutation policy, and host snapshot
// persistence. Runtime storage/indexing internals remain implementation-owned.
const MemoryVectors = """
  [
    {
      "name": "recall_ranks_by_weighted_score",
      "description": "Recall ranks by weighted lexical score: content match = 2, tag match = 3, core match boost = 1.",
      "stage": "memory",
      "input": {
        "operation": "recall",
        "store": {
          "entries": [
            {
              "content": "the sky is clear",
              "category": "insight"
            },
            {
              "content": "favorite color is blue sky",
              "category": "insight"
            },
            {
              "content": "unrelated text",
              "category": "insight",
              "tags": ["space"]
            },
            {
              "content": "always deploy on green",
              "category": "core"
            }
          ]
        },
        "query": "blue sky",
        "limit": 0
      },
      "expected": {
        "results": [
          {
            "content": "favorite color is blue sky",
            "category": "insight",
            "score": 4,
            "keyword_matches": 2
          },
          {
            "content": "the sky is clear",
            "category": "insight",
            "score": 2,
            "keyword_matches": 1
          }
        ]
      }
    },
    {
      "name": "recall_tags_and_core_boost",
      "description": "Recall gives tag matches higher weight than content matches and boosts matching core memories.",
      "stage": "memory",
      "input": {
        "operation": "recall",
        "store": {
          "entries": [
            {
              "content": "all about deploy",
              "category": "archival"
            },
            {
              "content": "unrelated text",
              "category": "insight",
              "tags": ["deploy"]
            },
            {
              "content": "always deploy on green",
              "category": "core"
            }
          ]
        },
        "query": "deploy",
        "limit": 0
      },
      "expected": {
        "results": [
          {
            "content": "unrelated text",
            "category": "insight",
            "score": 3,
            "keyword_matches": 1
          },
          {
            "content": "always deploy on green",
            "category": "core",
            "score": 3,
            "keyword_matches": 1
          },
          {
            "content": "all about deploy",
            "category": "archival",
            "score": 2,
            "keyword_matches": 1
          }
        ]
      }
    },
    {
      "name": "recall_empty_query_and_limit",
      "description": "Empty-query recall returns all memories in insertion order with score 0; positive limit truncates.",
      "stage": "memory",
      "input": {
        "operation": "recall",
        "store": {
          "entries": [
            {
              "content": "first",
              "category": "insight",
              "createdAt": "2024-01-03T00:00:00Z"
            },
            {
              "content": "second",
              "category": "core",
              "createdAt": "2024-01-01T00:00:00Z"
            },
            {
              "content": "third",
              "category": "archival",
              "createdAt": "2024-01-02T00:00:00Z"
            }
          ]
        },
        "query": "",
        "limit": 2
      },
      "expected": {
        "results": [
          {
            "content": "first",
            "category": "insight",
            "score": 0,
            "keyword_matches": 0
          },
          {
            "content": "second",
            "category": "core",
            "score": 0,
            "keyword_matches": 0
          }
        ]
      }
    },
    {
      "name": "remember_dedups_core_by_tags",
      "description": "Remember replaces an existing core memory with identical tags, appends the new memory, and leaves non-core entries intact.",
      "stage": "memory",
      "input": {
        "operation": "remember",
        "store": {
          "entries": [
            {
              "content": "old fact",
              "category": "core",
              "tags": ["subject"]
            },
            {
              "content": "summary",
              "category": "archival",
              "tags": ["subject"]
            }
          ]
        },
        "entry": {
          "content": "new fact",
          "category": "core",
          "tags": ["subject"]
        },
        "max_entries": 0
      },
      "expected": {
        "store": {
          "entries": [
            {
              "content": "summary",
              "category": "archival",
              "tags": ["subject"]
            },
            {
              "content": "new fact",
              "category": "core",
              "tags": ["subject"]
            }
          ]
        }
      }
    },
    {
      "name": "remember_evicts_archival_first",
      "description": "Remember enforces the cap by evicting the oldest archival memory before older core/insight entries.",
      "stage": "memory",
      "input": {
        "operation": "remember",
        "store": {
          "entries": [
            {
              "content": "core a",
              "category": "core",
              "tags": ["a"]
            },
            {
              "content": "archival b",
              "category": "archival"
            }
          ]
        },
        "entry": {
          "content": "core c",
          "category": "core",
          "tags": ["c"]
        },
        "max_entries": 2
      },
      "expected": {
        "store": {
          "entries": [
            {
              "content": "core a",
              "category": "core",
              "tags": ["a"]
            },
            {
              "content": "core c",
              "category": "core",
              "tags": ["c"]
            }
          ]
        }
      }
    },
    {
      "name": "format_core_and_recall_results",
      "description": "Formatting injects only core memories into system prompts and formats recall results with category and tags.",
      "stage": "memory",
      "input": {
        "operation": "format",
        "store": {
          "entries": [
            {
              "content": "persistent fact",
              "category": "core"
            },
            {
              "content": "a summary",
              "category": "archival"
            },
            {
              "content": "run the deploy",
              "category": "core",
              "tags": ["ops"]
            }
          ]
        },
        "query": "deploy"
      },
      "expected": {
        "system_prompt": "## Memory\\n- persistent fact\\n- run the deploy\\n",
        "recall_results": "1. [core] run the deploy\\n   tags: ops\\n"
      }
    },
    {
      "name": "clear_by_category_and_all",
      "description": "Clear removes only the requested category, or all memories when no category is supplied.",
      "stage": "memory",
      "input": {
        "operation": "clear",
        "store": {
          "entries": [
            {
              "content": "fact",
              "category": "core"
            },
            {
              "content": "summary",
              "category": "archival"
            },
            {
              "content": "another summary",
              "category": "archival"
            },
            {
              "content": "insight",
              "category": "insight"
            }
          ]
        },
        "category": "archival"
      },
      "expected": {
        "removed": 2,
        "store": {
          "entries": [
            {
              "content": "fact",
              "category": "core"
            },
            {
              "content": "insight",
              "category": "insight"
            }
          ]
        }
      }
    },
    {
      "name": "update_index_out_of_range_error",
      "description": "Updating a missing memory index signals a stable out-of-range error kind without relying on runtime-specific message text.",
      "stage": "memory",
      "input": {
        "operation": "update",
        "store": {
          "entries": [
            {
              "content": "only",
              "category": "core"
            }
          ]
        },
        "index": 3,
        "entry": {
          "content": "replacement",
          "category": "insight"
        }
      },
      "expectedError": {
        "kind": "index_out_of_range"
      }
    },
    {
      "name": "snapshot_port_round_trip",
      "description": "A host memory port persists and reloads the whole MemoryStore snapshot; recall runs against the reloaded snapshot.",
      "stage": "memory",
      "input": {
        "operation": "snapshot",
        "store": {
          "entries": []
        },
        "entry": {
          "content": "remember this",
          "category": "core"
        },
        "max_entries": 200,
        "query": "remember"
      },
      "expected": {
        "store": {
          "entries": [
            {
              "content": "remember this",
              "category": "core"
            }
          ]
        },
        "recalled": ["remember this"]
      }
    },
    {
      "name": "recall_tokenization_punctuation_unicode_and_dedup",
      "description": "Recall trims punctuation, lowercases tokens, preserves Unicode letters, and counts duplicate query tokens once.",
      "stage": "memory",
      "input": {
        "operation": "recall",
        "store": {
          "entries": [
            {
              "content": "deploy guide",
              "category": "insight"
            },
            {
              "content": "unrelated text",
              "category": "insight",
              "tags": ["café"]
            },
            {
              "content": "deploy café",
              "category": "core"
            }
          ]
        },
        "query": "DEPLOY, deploy!!! café",
        "limit": 0
      },
      "expected": {
        "results": [
          {
            "content": "deploy café",
            "category": "core",
            "score": 5,
            "keyword_matches": 2
          },
          {
            "content": "unrelated text",
            "category": "insight",
            "score": 3,
            "keyword_matches": 1
          },
          {
            "content": "deploy guide",
            "category": "insight",
            "score": 2,
            "keyword_matches": 1
          }
        ]
      }
    },
    {
      "name": "recall_score_ties_preserve_insertion_order",
      "description": "Recall preserves insertion order for memories with identical scores.",
      "stage": "memory",
      "input": {
        "operation": "recall",
        "store": {
          "entries": [
            {
              "content": "alpha first",
              "category": "insight"
            },
            {
              "content": "alpha second",
              "category": "insight"
            },
            {
              "content": "alpha third",
              "category": "insight"
            }
          ]
        },
        "query": "alpha",
        "limit": 0
      },
      "expected": {
        "results": [
          {
            "content": "alpha first",
            "category": "insight",
            "score": 2,
            "keyword_matches": 1
          },
          {
            "content": "alpha second",
            "category": "insight",
            "score": 2,
            "keyword_matches": 1
          },
          {
            "content": "alpha third",
            "category": "insight",
            "score": 2,
            "keyword_matches": 1
          }
        ]
      }
    },
    {
      "name": "remember_dedups_core_missing_and_empty_tags",
      "description": "Remember treats missing and empty tag lists as equivalent for core-memory deduplication.",
      "stage": "memory",
      "input": {
        "operation": "remember",
        "store": {
          "entries": [
            {
              "content": "old core with missing tags",
              "category": "core"
            },
            {
              "content": "old core with empty tags",
              "category": "core",
              "tags": []
            },
            {
              "content": "non-core survives",
              "category": "insight"
            }
          ]
        },
        "entry": {
          "content": "new core with empty tags",
          "category": "core",
          "tags": []
        },
        "max_entries": 0
      },
      "expected": {
        "store": {
          "entries": [
            {
              "content": "non-core survives",
              "category": "insight"
            },
            {
              "content": "new core with empty tags",
              "category": "core",
              "tags": []
            }
          ]
        }
      }
    }
  ]
  """;
