//! Renderer implementations — template engines that produce rendered text.
//!
//! Built-in renderers:
//! - `NunjucksRenderer` (key: `"nunjucks"` and `"jinja2"`) — uses MiniJinja
//! - `MustacheRenderer` (key: `"mustache"`) — uses ribboncurls

mod common;
mod mustache;
mod nunjucks;

pub use common::{prepare_render_inputs, RICH_KINDS};
pub use mustache::MustacheRenderer;
pub use nunjucks::NunjucksRenderer;
