package com.microsoft.ai.prompty.models;

import java.util.List;
import java.util.Map;

public class Prompty {
    private ModelConfig model;
    private Map<String, Object> parameters;
    private String response;
    private String name;
    private String description;
    private String version;
    private List<String> authors;
    private List<String> tags;
    private Map<String, Object> inputs;
    private Map<String, Object> outputs;
    private String template;

    public ModelConfig getModel() {
        return model;
    }

    public void setModel(ModelConfig model) {
        this.model = model;
    }

    public Map<String, Object> getParameters() {
        return parameters;
    }

    public void setParameters(Map<String, Object> parameters) {
        this.parameters = parameters;
    }

    public String getResponse() {
        return response;
    }

    public void setResponse(String response) {
        this.response = response;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getVersion() {
        return version;
    }

    public void setVersion(String version) {
        this.version = version;
    }

    public List<String> getAuthors() {
        return authors;
    }

    public void setAuthors(List<String> authors) {
        this.authors = authors;
    }

    public List<String> getTags() {
        return tags;
    }

    public void setTags(List<String> tags) {
        this.tags = tags;
    }

    public Map<String, Object> getInputs() {
        return inputs;
    }

    public void setInputs(Map<String, Object> inputs) {
        this.inputs = inputs;
    }

    public Map<String, Object> getOutputs() {
        return outputs;
    }

    public void setOutputs(Map<String, Object> outputs) {
        this.outputs = outputs;
    }

    public String getTemplate() {
        return template;
    }

    public void setTemplate(String template) {
        this.template = template;
    }

    /**
     * Model configuration section of the prompty.
     */
    public static class ModelConfig {
        private String api;
        private Map<String, Object> configuration;
        private Map<String, Object> parameters;
        private String response;

        public static final String API_CHAT = "chat";
        public static final String API_COMPLETION = "completion";
        public static final String RESPONSE_FIRST = "first";
        public static final String RESPONSE_ALL = "all";

        public String getApi() {
            return api;
        }

        public void setApi(String api) {
            this.api = api;
        }

        public Map<String, Object> getConfiguration() {
            return configuration;
        }

        public void setConfiguration(Map<String, Object> configuration) {
            this.configuration = configuration;
        }

        public Map<String, Object> getParameters() {
            return parameters;
        }

        public void setParameters(Map<String, Object> parameters) {
            this.parameters = parameters;
        }

        public String getResponse() {
            return response;
        }

        public void setResponse(String response) {
            this.response = response;
        }
    }
}
