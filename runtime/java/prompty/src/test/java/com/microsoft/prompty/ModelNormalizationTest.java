package com.microsoft.prompty;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.microsoft.prompty.model.ApiKeyConnection;
import com.microsoft.prompty.model.Connection;
import com.microsoft.prompty.model.CustomTool;
import com.microsoft.prompty.model.FunctionTool;
import com.microsoft.prompty.model.Property;
import com.microsoft.prompty.model.Prompty;
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
 * Locks in the behaviour that {@code schema/scripts/normalize-java-output.mjs} adds on top of the
 * Typra Java emitter output.
 *
 * <p>The emitter currently ships several defects that would otherwise make the Java model diverge
 * from the C# and Rust runtimes. The generated example suites do not cover them, so these
 * assertions guard the normalization pass itself: if a future emitter release changes shape and the
 * pass silently stops matching, these tests fail.
 */
class ModelNormalizationTest {

  @Nested
  @DisplayName("named-dictionary collections")
  class NamedDictionaries {

    @Test
    @DisplayName("inputs declared as a name-keyed dict load with the key as name")
    void loadsNameKeyedDictionary() {
      Prompty prompty =
          Prompty.fromJson(
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
    @DisplayName("scalar dict values widen through the shorthand property")
    void widensScalarDictionaryValues() {
      Prompty prompty =
          Prompty.fromJson("{\"kind\": \"prompt\", \"inputs\": {\"question\": \"What is 2 + 2?\"}}");

      // The generated layer only injects the key as `name` and widens the scalar through the
      // element's shorthand property, matching Prompty.Core's FunctionTool.LoadParameters.
      // Inferring `kind` and populating `default` is the loader's job (spec §4.3 step 6d).
      assertNotNull(prompty.inputs);
      assertEquals(1, prompty.inputs.size());
      assertEquals("question", prompty.inputs.get(0).name);
      assertEquals("What is 2 + 2?", prompty.inputs.get(0).example);
    }

    @Test
    @DisplayName("the flat list form still loads")
    void loadsFlatList() {
      Prompty prompty =
          Prompty.fromJson(
              "{\"kind\": \"prompt\", \"inputs\": [{\"name\": \"firstName\", \"kind\": \"string\"}]}");

      assertNotNull(prompty.inputs);
      assertEquals(1, prompty.inputs.size());
      assertEquals("firstName", prompty.inputs.get(0).name);
    }

    @Test
    @DisplayName("a nested array value is rejected with an actionable message")
    void rejectsNestedArrayValues() {
      IllegalArgumentException error =
          assertThrows(
              IllegalArgumentException.class,
              () -> Prompty.fromJson("{\"kind\": \"prompt\", \"inputs\": {\"firstName\": [1, 2]}}"));

      assertTrue(error.getMessage().contains("'inputs'"), error.getMessage());
      assertTrue(error.getMessage().contains("firstName"), error.getMessage());
      // The canonical `recursive-array-valued-entry-rejection` contract requires the
      // diagnostic to name the category as well as the path.
      assertTrue(error.getMessage().contains("array"), error.getMessage());
    }

    @Test
    @DisplayName("an array-valued entry is rejected at every nested collection boundary")
    void rejectsNestedArrayValuesRecursively() {
      // `recursive-array-valued-entry-rejection` applies at every named-collection
      // boundary, not just the top-level one, so the two reachable nested boundaries
      // are asserted directly: a collection inside a list element, and one reached
      // through a subclass field.
      IllegalArgumentException insideListElement =
          assertThrows(
              IllegalArgumentException.class,
              () ->
                  Prompty.fromJson(
                      """
                      {
                        "kind": "prompt",
                        "tools": [{"name": "t", "kind": "function", "parameters": {"toolArg": [1, 2]}}]
                      }
                      """));

      assertTrue(insideListElement.getMessage().contains("'parameters'"), insideListElement.getMessage());
      assertTrue(insideListElement.getMessage().contains("toolArg"), insideListElement.getMessage());
      assertTrue(insideListElement.getMessage().contains("array"), insideListElement.getMessage());

      IllegalArgumentException throughSubclass =
          assertThrows(
              IllegalArgumentException.class,
              () ->
                  Prompty.fromJson(
                      """
                      {
                        "kind": "prompt",
                        "inputs": {"cfg": {"kind": "object", "properties": {"nestedField": [1, 2]}}}
                      }
                      """));

      assertTrue(throughSubclass.getMessage().contains("'properties'"), throughSubclass.getMessage());
      assertTrue(throughSubclass.getMessage().contains("nestedField"), throughSubclass.getMessage());
      assertTrue(throughSubclass.getMessage().contains("array"), throughSubclass.getMessage());
    }

    @Test
    @DisplayName("tool parameters accept the name-keyed dict form")
    void loadsToolParameterDictionary() {
      Prompty prompty =
          Prompty.fromJson(
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
    @DisplayName("an unknown tool kind falls back to CustomTool")
    void unknownToolKindFallsBackToCustomTool() {
      Tool tool = Tool.fromJson("{\"kind\": \"my_provider\", \"name\": \"whatever\"}");

      CustomTool custom = assertInstanceOf(CustomTool.class, tool);
      assertEquals("my_provider", custom.kind);
      assertEquals("whatever", custom.name);
    }

    @Test
    @DisplayName("an unknown connection kind is rejected")
    void unknownConnectionKindThrows() {
      assertThrows(IllegalArgumentException.class, () -> Connection.fromJson("{\"kind\": \"nope\"}"));
    }

    @Test
    @DisplayName("the discriminator is matched case-insensitively")
    void discriminatorIsCaseInsensitive() {
      assertInstanceOf(ApiKeyConnection.class, Connection.fromJson("{\"kind\": \"Key\"}"));
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
      Prompty prompty =
          Prompty.fromJson(
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
      Prompty prompty =
          Prompty.fromJson("{\"kind\": \"prompt\", \"inputs\": {\"firstName\": {\"kind\": \"string\"}}}");
      SaveContext context = new SaveContext();
      context.collectionFormat = "array";

      Object saved = prompty.save(context).get("inputs");

      List<?> inputs = assertInstanceOf(List.class, saved);
      assertEquals(1, inputs.size());
      Map<?, ?> first = assertInstanceOf(Map.class, inputs.get(0));
      assertEquals("firstName", first.get("name"));
      assertEquals("string", first.get("kind"));
    }

    @Test
    @DisplayName("a shorthand input round-trips to its expanded form, as in C# and Rust")
    void shorthandExpandsOnSave() {
      Prompty prompty = Prompty.fromJson("{\"kind\": \"prompt\", \"inputs\": {\"firstName\": \"Jane\"}}");

      Map<?, ?> inputs = assertInstanceOf(Map.class, prompty.save(new SaveContext()).get("inputs"));

      // `kind` is a required property, so a saved Property always carries at least
      // two keys and the scalar collapse in saveList never applies to it. The
      // loader — not the model layer — is what infers the kind (spec 4.3 step 6d).
      Map<?, ?> first = assertInstanceOf(Map.class, inputs.get("firstName"));
      assertEquals("Jane", first.get("example"));
      assertFalse(first.containsKey("name"), "the key carries the name, so it is not repeated inside");
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
      Prompty prompty =
          Prompty.fromJson(
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
    @DisplayName("duplicate names silently drop an entry on save")
    void duplicateNamesCollapseOnSave() {
      // Documents a divergence from the canonical `named-collection-lossless-fallback`
      // contract, which requires the name-keyed object form only when every name is
      // non-empty *and* unique, and the whole ordered array otherwise. Java currently
      // applies that fallback to unnamed entries (above) but not to duplicates: both
      // entries load, then the save keys them onto one name and the earlier payload is
      // overwritten. Invert this test when the emitter detects duplicates before
      // building the map -- `saved` should then be a two-element List.
      Prompty prompty =
          Prompty.fromJson(
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

      Map<?, ?> saved = assertInstanceOf(Map.class, inputs);
      assertEquals(1, saved.size(), "the collision is the divergence being recorded");
      Map<?, ?> survivor = assertInstanceOf(Map.class, saved.get("a"));
      assertEquals("integer", survivor.get("kind"), "the later entry overwrites the earlier one");
    }

    @Test
    @DisplayName("an eligible collection loaded as a list still saves as a name-keyed object")
    void namedListSavesAsObject() {
      Prompty prompty =
          Prompty.fromJson(
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
      Prompty prompty =
          Prompty.fromJson(
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
