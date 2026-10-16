// Independent project registries belong to catalogue-backed workspaces.
// Document-format workspaces retain their embedded project navigation.
export const hasProjectDirectory=state=>state.storage?.researchStorage==='catalogue';
