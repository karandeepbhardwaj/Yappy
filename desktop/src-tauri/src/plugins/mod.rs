use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionDefinition {
    pub id: String,
    pub name: String,
    pub description: String,
    pub params: Vec<ParamDef>,
    pub risk: String, // "safe" or "destructive"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParamDef {
    pub name: String,
    pub description: String,
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResult {
    pub success: bool,
    pub message: String,
}

pub trait AppPlugin: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn platforms(&self) -> &[&str]; // ["macos", "windows"]
    fn actions(&self) -> Vec<ActionDefinition>;
    fn execute(&self, action_id: &str, params: &serde_json::Value) -> ActionResult;
    fn is_available(&self) -> bool;
}

pub struct PluginRegistry {
    plugins: Vec<Box<dyn AppPlugin>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        let mut registry = Self { plugins: Vec::new() };

        registry.register(Box::new(chrome::ChromePlugin));
        registry.register(Box::new(notes::NotesPlugin));
        registry.register(Box::new(outlook::OutlookPlugin));

        registry
    }

    fn register(&mut self, plugin: Box<dyn AppPlugin>) {
        let platform = if cfg!(target_os = "macos") { "macos" } else { "windows" };
        if plugin.platforms().contains(&platform) {
            self.plugins.push(plugin);
        }
    }

    pub fn find(&self, app_id: &str) -> Option<&dyn AppPlugin> {
        self.plugins.iter().find(|p| p.id() == app_id).map(|p| p.as_ref())
    }

    pub fn list(&self) -> Vec<serde_json::Value> {
        self.plugins.iter().map(|p| {
            serde_json::json!({
                "id": p.id(),
                "name": p.name(),
                "actions": p.actions(),
                "available": p.is_available()
            })
        }).collect()
    }

    pub fn execute(&self, app_id: &str, action_id: &str, params: &serde_json::Value) -> ActionResult {
        match self.find(app_id) {
            Some(plugin) => plugin.execute(action_id, params),
            None => ActionResult { success: false, message: format!("Plugin '{}' not found", app_id) },
        }
    }
}

pub mod chrome;
pub mod notes;
pub mod outlook;
