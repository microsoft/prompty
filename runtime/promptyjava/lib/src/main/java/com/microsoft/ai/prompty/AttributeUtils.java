package com.microsoft.ai.prompty;

import java.util.Map;
import java.util.List;

public class AttributeUtils {
    public static String getString(Map<String, Object> attributes, String attrName) {
        if (String.class.isInstance(attributes.get(attrName))) {
            return (String)attributes.get(attrName);
        } else {
            return null;
        }
    }

    public static List<String> getStringList(Map<String, Object> attributes, String attrName) {
        Object attr = attributes.get(attrName);
        if (attr instanceof List) {
            List<String> rawList = (List)attr;
            for (Object item : rawList) {
                if (!(item instanceof String)) {
                    return null;
                }
            }
            return (List<String>)rawList;
        } else {
            return null;
        }
    }

    public static Map<String, Object> getMap(Map<String, Object> attributes, String attrName) {
        if (Map.class.isInstance(attributes.get(attrName))) {
            return (Map<String, Object>)attributes.get(attrName);
        } else {
            return null;
        }
    }
}
