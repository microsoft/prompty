//! Renderer implementations — template engines that produce rendered text.
//!
//! Built-in renderers:
//! - `NunjucksRenderer` (key: `"nunjucks"` and `"jinja2"`) — uses MiniJinja
//! - `MustacheRenderer` (key: `"mustache"`) — placeholder for future implementation

mod common;
mod nunjucks;

pub use common::{clear_last_nonces, get_last_nonces, prepare_render_inputs, RICH_KINDS};
pub use nunjucks::NunjucksRenderer;
