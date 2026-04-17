// Prompty schema entry point
import "./agent/agent.tsp";
import "./agent/guardrails.tsp";
import "./message/message.tsp";
import "./events/events.tsp";
import "./discovery/discovery.tsp";
import "./pipeline/pipeline.tsp";
import "./model/usage.tsp";
import "./protocols/protocols.tsp";

// Wire format mappings (augment existing models with provider field names)
import "./wire/openai.tsp";
import "./wire/anthropic.tsp";
