package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.Connection;
import com.microsoft.prompty.model.FunctionTool;
import com.microsoft.prompty.model.Property;
import com.microsoft.prompty.model.Agent;
import com.microsoft.prompty.model.ReplayJournalRecord;
import com.microsoft.prompty.model.SaveContext;
import com.microsoft.prompty.model.SessionEvent;
import com.microsoft.prompty.model.SessionEventType;
import com.microsoft.prompty.model.Tool;
import com.microsoft.prompty.model.ToolResult;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Locks in loader- and model-layer normalization behaviour that the generated example suites do not
 * cover: scalar-shorthand widening in the loader, named-collection save fallback, discriminated
 * union dispatch, and scalar shorthand dispatch. These assertions pin behaviour defined by the spec
 * and shared with the C# and Rust runtimes, not by any Java-specific post-generation step.
 */
class ModelNormalizationTest {

  @Nested
  @DisplayName("named-dictionary collections")
  class NamedDictionaries {

    @Test
    @DisplayName("inputs declared as a name-keyed dict load with the key as name")
    void loadsNameKeyedDictionary() {
      Agent prompty =
          Agent.fromJson(
              """
              {
                "kind": "prompt",
                "inputs": {
                  "firstName": {"kind": "string", "description": "Given name"},
                  "age": {"kind": "integer"}
                }
              }
              """);

      assertNotNull(prompty.inputs);
      assertEquals(2, prompty.inputs.size());
      assertEquals("firstName", prompty.inputs.get(0).name);
      assertEquals("string", prompty.inputs.get(0).kind);
      assertEquals("Given name", prompty.inputs.get(0).description);
      assertEquals("age", prompty.inputs.get(1).name);
      assertEquals("integer", prompty.inputs.get(1).kind);
    }

    @Test
    @DisplayName("scalar dict values widen through the loader's shorthand expansion")
    void widensScalarDictionaryValues() {
      // Scalar shorthand widening (spec §4.3) is a loading concern: the loader infers the property
      // kind and stores the scalar as the default. The model layer intentionally rejects a
      // kind-less property, so this is asserted against the Loader rather than Agent.fromJson.
      Agent prompty =
          Loader.loadFromString(
              """
              ---
              name: scalar-widen
              model: gpt-4
              inputs:
                question: What is 2 + 2?
              ---
              system:
              placeholder
              """,
              java.nio.file.Path.of("virtual.prompty"));

      assertNotNull(prompty.inputs);
      assertEquals(1, prompty.inputs.size());
      assertEquals("question", prompty.inputs.get(0).name);
      assertEquals("string", prompty.inputs.get(0).kind);
      assertEquals("What is 2 + 2?", prompty.inputs.get(0).defaultValue);
    }

    @Test
    @DisplayName("the flat list form still loads")
    void loadsFlatList() {
      Agent prompty =
          Agent.fromJson(
              "{\"kind\": \"prompt\", \"inputs\": [{\"name\": \"firstName\", \"kind\": \"string\"}]}");

      assertNotNull(prompty.inputs);
      assertEquals(1, prompty.inputs.size());
      assertEquals("firstName", prompty.inputs.get(0).name);
    }

    @Test
    @DisplayName("tool parameters accept the name-keyed dict form")
    void loadsToolParameterDictionary() {
      Agent prompty =
          Agent.fromJson(
              """
              {
                "kind": "prompt",
                "tools": [
                  {
                    "kind": "function",
                    "name": "get_weather",
                    "parameters": {"city": {"kind": "string", "required": true}}
                  }
                ]
              }
              """);

      assertNotNull(prompty.tools);
      FunctionTool tool = assertInstanceOf(FunctionTool.class, prompty.tools.get(0));
      assertNotNull(tool.parameters);
      assertEquals(1, tool.parameters.size());
      assertEquals("city", tool.parameters.get(0).name);
      assertEquals("string", tool.parameters.get(0).kind);
    }
  }

  @Nested
  @DisplayName("scalar shorthand dispatch")
  class ScalarShorthand {

    @Test
    @DisplayName("integral values load as integer, not float")
    void loadsIntegerShorthand() {
      Property property = Property.fromJson("1");

      assertEquals("integer", property.kind);
      assertEquals(1, property.example);
    }

    @Test
    @DisplayName("fractional values load as float")
    void loadsFloatShorthand() {
      Property property = Property.fromJson("1.5");

      assertEquals("float", property.kind);
      assertEquals(1.5f, property.example);
    }

    @Test
    @DisplayName("booleans and strings keep their own branches")
    void loadsOtherScalarShorthands() {
      assertEquals("boolean", Property.fromJson("true").kind);
      assertEquals("string", Property.fromJson("\"hello\"").kind);
    }
  }

  @Nested
  @DisplayName("discriminated unions")
  class DiscriminatedUnions {

    @Test
    @DisplayName("an unknown connection kind is rejected")
    void unknownConnectionKindThrows() {
      assertThrows(IllegalArgumentException.class, () -> Connection.fromJson("{\"kind\": \"nope\"}"));
    }
  }

  @Nested
  @DisplayName("inherited properties")
  class Inheritance {

    @Test
    @DisplayName("a subclass load() populates base-class fields")
    void subclassPopulatesBaseFields() {
      FunctionTool tool =
          FunctionTool.fromJson(
              "{\"kind\": \"function\", \"name\": \"get_weather\", \"description\": \"Look up weather\"}");

      // `name` and `description` are declared on Tool, not FunctionTool.
      assertEquals("get_weather", tool.name);
      assertEquals("Look up weather", tool.description);
      assertEquals("function", tool.kind);
    }

    @Test
    @DisplayName("save() round-trips base-class fields")
    void saveRoundTripsBaseFields() {
      String json =
          FunctionTool.fromJson("{\"kind\": \"function\", \"name\": \"get_weather\"}").toJson();

      assertTrue(json.contains("\"name\""), json);
      assertTrue(json.contains("get_weather"), json);
      assertTrue(json.contains("function"), json);
    }
  }

  @Nested
  @DisplayName("collection saves")
  class CollectionSaves {

    @Test
    @DisplayName("named collections save as a name-keyed dictionary by default")
    void savesNameKeyedDictionary() {
      Agent prompty =
          Agent.fromJson(
              """
              {
                "kind": "prompt",
                "inputs": {
                  "firstName": {"kind": "string", "description": "Given name"},
                  "age": {"kind": "integer", "description": "Years"}
                }
              }
              """);

      Object saved = prompty.save(new SaveContext()).get("inputs");

      Map<?, ?> inputs = assertInstanceOf(Map.class, saved);
      assertEquals(List.of("firstName", "age"), List.copyOf(inputs.keySet()));
      Map<?, ?> first = assertInstanceOf(Map.class, inputs.get("firstName"));
      assertEquals("string", first.get("kind"));
      assertFalse(first.containsKey("name"), "the key carries the name, so it is not repeated inside");
    }

    @Test
    @DisplayName("collectionFormat=array falls back to a flat list that keeps the name")
    void savesArrayFormatOnRequest() {
      Agent prompty =
          Agent.fromJson("{\"kind\": \"prompt\", \"inputs\": {\"firstName\": {\"kind\": \"string\"}}}");
      SaveContext context = new SaveContext("array", true);

      Object saved = prompty.save(context).get("inputs");

      List<?> inputs = assertInstanceOf(List.class, saved);
      assertEquals(1, inputs.size());
      Map<?, ?> first = assertInstanceOf(Map.class, inputs.get(0));
      assertEquals("firstName", first.get("name"));
      assertEquals("string", first.get("kind"));
    }

    @Test
    @DisplayName("optional properties stay absent unless the wire data supplies them")
    void optionalPropertiesAreNotMaterialized() {
      Property property = Property.fromJson("{\"kind\": \"string\"}");

      assertNull(property.description);
      assertNull(property.required);
      assertNull(property.nullable);
      Map<String, Object> saved = property.save(new SaveContext());
      assertEquals(List.of("name", "kind"), List.copyOf(saved.keySet()));
    }

    @Test
    @DisplayName("unnamed entries fall back to array format rather than collapsing onto one key")
    void unnamedEntriesFallBackToArray() {
      Agent prompty =
          Agent.fromJson(
              """
              {
                "kind": "prompt",
                "inputs": [{"kind": "string"}, {"kind": "integer"}]
              }
              """);

      Object inputs = prompty.save(new SaveContext()).get("inputs");

      List<?> saved = assertInstanceOf(List.class, inputs, "unnamed members cannot be keyed by name");
      assertEquals(2, saved.size());
    }

    @Test
    @DisplayName("duplicate names fall back to the ordered array on save")
    void duplicateNamesFallBackToArray() {
      // The named-collection-lossless-fallback contract keeps the name-keyed object form only when
      // every name is non-empty and unique; duplicate names force the whole ordered array so no
      // entry is silently overwritten.
      Agent prompty =
          Agent.fromJson(
              """
              {
                "kind": "prompt",
                "inputs": [
                  {"name": "a", "kind": "string"},
                  {"name": "a", "kind": "integer"}
                ]
              }
              """);

      assertEquals(2, prompty.inputs.size(), "both entries must survive the load");

      Object inputs = prompty.save(new SaveContext()).get("inputs");

      List<?> saved = assertInstanceOf(List.class, inputs, "duplicates cannot be keyed by name");
      assertEquals(2, saved.size(), "both entries are preserved by the array fallback");
      Map<?, ?> firstEntry = assertInstanceOf(Map.class, saved.get(0));
      Map<?, ?> secondEntry = assertInstanceOf(Map.class, saved.get(1));
      assertEquals("string", firstEntry.get("kind"), "the first entry keeps its kind");
      assertEquals("integer", secondEntry.get("kind"), "the second entry keeps its kind");
    }

    @Test
    @DisplayName("an eligible collection loaded as a list still saves as a name-keyed object")
    void namedListSavesAsObject() {
      Agent prompty =
          Agent.fromJson(
              """
              {
                "kind": "prompt",
                "inputs": [
                  {"name": "firstName", "kind": "string"},
                  {"name": "age", "kind": "integer"}
                ]
              }
              """);

      Map<?, ?> inputs = assertInstanceOf(Map.class, prompty.save(new SaveContext()).get("inputs"));

      assertEquals(List.of("firstName", "age"), List.copyOf(inputs.keySet()));
      assertEquals("string", assertInstanceOf(Map.class, inputs.get("firstName")).get("kind"));
      assertEquals("integer", assertInstanceOf(Map.class, inputs.get("age")).get("kind"));
    }

    @Test
    @DisplayName("a plain Property[] stays an array even when its members are named")
    void plainPropertyArraysStayArrays() {
      Agent prompty =
          Agent.fromJson(
              """
              {
                "kind": "prompt",
                "inputs": {
                  "choice": {
                    "kind": "union",
                    "anyOf": [
                      {"name": "asText", "kind": "string"},
                      {"name": "asNumber", "kind": "integer"}
                    ]
                  }
                }
              }
              """);

      Map<?, ?> inputs = assertInstanceOf(Map.class, prompty.save(new SaveContext()).get("inputs"));
      Map<?, ?> choice = assertInstanceOf(Map.class, inputs.get("choice"));

      // `anyOf` is declared `Property[]`, not the `Properties` named-collection
      // alias, so it is array-only regardless of whether members carry names —
      // matching UnionProperty.SaveAnyOf in the C# runtime.
      List<?> anyOf = assertInstanceOf(List.class, choice.get("anyOf"));
      assertEquals(2, anyOf.size());
      assertEquals("asText", assertInstanceOf(Map.class, anyOf.get(0)).get("name"));
      assertEquals("asNumber", assertInstanceOf(Map.class, anyOf.get(1)).get("name"));
    }

    @Test
    @DisplayName("collections whose element type has no name always save as arrays")
    void unnamedElementTypesStayArrays() {
      ToolResult result =
          ToolResult.fromJson(
              """
              {
                "callId": "call_1",
                "parts": [{"kind": "text", "text": "sunny"}]
              }
              """);

      Object parts = result.save(new SaveContext()).get("parts");

      assertInstanceOf(List.class, parts, "ContentPart has no 'name', so object format is not available");
    }

    @Test
    @DisplayName("the postSave hook runs exactly once for a derived class")
    void postSaveRunsOnceForDerivedClasses() {
      AtomicInteger calls = new AtomicInteger();
      SaveContext context =
          new SaveContext(
              null,
              dict -> {
                calls.incrementAndGet();
                return dict;
              });

      FunctionTool.fromJson("{\"kind\": \"function\", \"name\": \"get_weather\"}").save(context);

      assertEquals(1, calls.get(), "the base class owns the hook; subclasses must not re-run it");
    }
  }

  @Nested
  @DisplayName("reserved word renames")
  class ReservedWords {

    @Test
    @DisplayName("the wire key stays 'default' while the Java field is 'defaultValue'")
    void defaultKeepsItsWireName() {
      Property property = Property.fromJson("{\"kind\": \"string\", \"default\": \"Jane\"}");

      assertEquals("Jane", property.defaultValue);
      assertTrue(property.toJson().contains("\"default\""), property.toJson());
    }

    @Test
    @DisplayName("string data that merely looks like a reserved word is untouched")
    void stringDataIsNotRewritten() {
      String scope = "https://cognitiveservices.azure.com/.default";
      Connection connection =
          Connection.fromJson("{\"kind\": \"oauth\", \"scopes\": [\"" + scope + "\"]}");

      assertTrue(connection.toJson().contains(scope), connection.toJson());
    }
  }

  @Nested
  @DisplayName("required enum defaults")
  class RequiredEnums {

    @Test
    @DisplayName("a required enum omitted from the wire data still round-trips its default")
    void requiredEnumDefaultsToFirstConstant() {
      SessionEvent event = SessionEvent.fromJson("{}");

      // C# seeds required enums with the first declared constant
      // (SessionEvent.cs:37) and saves them unconditionally, so an omitted
      // required enum must never vanish from the saved dictionary.
      assertEquals(SessionEventType.SESSION_START, event.type);
      assertEquals("session_start", event.save(new SaveContext()).get("type"));
    }

    @Test
    @DisplayName("an explicit required enum value survives the round trip")
    void explicitRequiredEnumIsPreserved() {
      SessionEvent event = SessionEvent.fromJson("{\"type\": \"session_end\"}");

      assertEquals(SessionEventType.SESSION_END, event.type);
      assertEquals("session_end", event.save(new SaveContext()).get("type"));
    }

    @Test
    @DisplayName("an optional enum stays null and is omitted when unset")
    void optionalEnumStaysAbsent() {
      Map<String, Object> saved = ReplayJournalRecord.fromJson("{\"kind\": \"session\"}").save(new SaveContext());

      assertEquals("session", saved.get("kind"));
      assertFalse(saved.containsKey("status"), saved.toString());
    }
  }
}
