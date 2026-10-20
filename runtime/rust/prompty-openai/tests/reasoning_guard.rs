use prompty::model::{Agent, context::LoadContext};
use prompty_openai::wire::{build_chat_args, build_responses_args, enable_streaming};
use serde_json::{Value, json};

#[test]
fn shared_execution_reasoning_guards() {
    let vectors: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../schema/model/conformance/openai-reasoning-guard.json"
    ))
    .unwrap();
    for vector in vectors {
        let input = json!({"name":"guard", "kind":"prompt", "model":{
            "id":vector["model"], "provider":"openai", "options":vector["options"]
        }});
        let agent = Agent::load_from_value(&input, &LoadContext::default());
        for (api, mut args) in [
            ("chat", build_chat_args(&agent, &[]).unwrap()),
            ("responses", build_responses_args(&agent, &[]).unwrap()),
        ] {
            enable_streaming(&mut args, api);
            for key in vector["absent"].as_array().unwrap() {
                assert!(
                    args.get(key.as_str().unwrap()).is_none(),
                    "{} {api}: {key}",
                    vector["name"]
                );
            }
            for (key, value) in vector["present"].as_object().unwrap() {
                // JSON integers and floats represent the same numeric option.
                if value.is_number() {
                    assert_eq!(
                        args[key].as_f64(),
                        value.as_f64(),
                        "{} {api}: {key}",
                        vector["name"]
                    );
                } else {
                    assert_eq!(&args[key], value, "{} {api}: {key}", vector["name"]);
                }
            }
        }
        // Executing the builders twice must not change the source options.
        let again = Agent::load_from_value(&input, &LoadContext::default());
        assert_eq!(
            prompty::model_access::model_options(&agent.model).map(|o| o.to_wire("openai")),
            prompty::model_access::model_options(&again.model).map(|o| o.to_wire("openai"))
        );
    }
}
