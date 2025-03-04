package com.microsoft.ai.prompty;

import org.junit.Test;
import static org.junit.Assert.*;

import java.util.HashMap;
import com.microsoft.ai.prompty.models.Prompty;

public class PromptyTest {
    String filePath = "/Users/weiwu/Workspace/Microsoft/AzureAI/prompty/runtime/prompty/tests/prompts/basic.prompty";

    @Test
    public void testRenderPrompty() {
        Prompty prompty = PromptyUtils.load(filePath);

        assertEquals(prompty.getName(), "Basic Prompt");
        assertEquals(prompty.getDescription(), "A basic prompt that uses the GPT-3 chat API to answer questions");
        assertEquals(prompty.getModel().getApi(), "chat");
        assertEquals(prompty.getModel().getConfiguration().get("azure_deployment"), "gpt-35-turbo");

        HashMap<String, Object> scopes = new HashMap<String, Object>();
        scopes.put("query", "system-query");
        scopes.put("question", "user-question");
        scopes.put("firstName", "John");
        scopes.put("lastName", "Doe");
        String prompt = PromptyUtils.render(prompty, scopes);
        assertTrue("should container the name", prompt.indexOf("John Doe") > 0);
        assertTrue("should container system query", prompt.indexOf("system-query") > 0);
        assertTrue("should container user question", prompt.indexOf("user-question") > 0);
    }
}
