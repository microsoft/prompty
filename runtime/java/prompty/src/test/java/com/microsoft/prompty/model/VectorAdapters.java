package com.microsoft.prompty.model;

import com.microsoft.prompty.jinjasubset.JinjaSubsetRenderer;
import com.microsoft.prompty.jinjasubset.Segment;
import com.microsoft.prompty.jinjasubset.StrictViolationException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Hand-written adapters for the generated vector conformance harness. */
public final class VectorAdapters {
  private VectorAdapters() {}

  public static Map<String, VectorConformanceTests.VectorAdapter> adapters() {
    Map<String, VectorConformanceTests.VectorAdapter> adapters = new LinkedHashMap<>();
    adapters.put("Renderer.renderSegments", new VectorConformanceTests.VectorAdapter(VectorAdapters::renderSegments));
    return adapters;
  }

  public static Map<String, String> waivers() {
    Map<String, String> waivers = new LinkedHashMap<>();
    waivers.put("DiscoveryConformance.enrich", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("DiscoveryConformance.mapModel", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("LoadConformance.load", "Covered by Java LoadVectorsTest; generated adapter not implemented yet.");
    waivers.put("Renderer.render", "Covered by Java RenderVectorsTest; generated adapter not implemented yet.");
    waivers.put("Parser.parse", "Covered by Java ParseVectorsTest; generated adapter not implemented yet.");
    waivers.put("Processor.process", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("Processor.processStream", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("WireConformance.toRequest", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("TurnConformance.run", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("TurnConformance.replay", "Java conformance adapter not implemented in this runtime yet.");
    waivers.put("TurnConformance.runTurn", "Java conformance adapter not implemented in this runtime yet.");
    return waivers;
  }

  public static Object doubles() {
    return new LinkedHashMap<String, Object>();
  }

  @SuppressWarnings("unchecked")
  private static Object renderSegments(Object input, VectorConformanceTests.VectorContext ctx) {
    Map<String, Object> map = input instanceof Map<?, ?> m ? copyMap(m) : new LinkedHashMap<>();
    String template = string(map.get("template"));
    Map<String, Object> inputs = map.get("inputs") instanceof Map<?, ?> m ? copyMap(m) : new LinkedHashMap<>();
    List<String> strictProps = new ArrayList<>();
    if (map.get("strict_props") instanceof Iterable<?> items) {
      for (Object item : items) if (item != null) strictProps.add(String.valueOf(item));
    }

    Map<String, Object> result = new LinkedHashMap<>();
    try {
      List<Object> serialized = new ArrayList<>();
      for (Segment segment : JinjaSubsetRenderer.renderSegments(template, inputs, strictProps)) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("kind", segment.kind());
        out.put("text", segment.text());
        out.put("source", segment.source());
        out.put("strict", segment.strict());
        serialized.add(out);
      }
      result.put("segments", serialized);
    } catch (StrictViolationException ex) {
      result.put("error", "StrictViolation");
    }
    return result;
  }

  private static String string(Object value) {
    return value instanceof String s ? s : "";
  }

  private static Map<String, Object> copyMap(Map<?, ?> source) {
    Map<String, Object> result = new LinkedHashMap<>();
    for (Map.Entry<?, ?> entry : source.entrySet()) result.put(String.valueOf(entry.getKey()), entry.getValue());
    return result;
  }
}
