// Prompty schema entry point
import "./agent.tsp";
import "./message.tsp";
import "./guardrails.tsp";
import "./events.tsp";
import "./discovery.tsp";
import "./pipeline.tsp";
import "./usage.tsp";

// Wire format mappings (augment existing models with provider field names)
import "./wire/openai.tsp";
import "./wire/anthropic.tsp";
