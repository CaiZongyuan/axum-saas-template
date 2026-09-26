fn main() -> Result<(), Box<dyn std::error::Error>> {
    let fields = saas_platform::config::FIELDS
        .iter()
        .chain(saas_app::modules::jobs::FIELDS)
        .chain(saas_platform::cache::FIELDS)
        .chain(saas_app::modules::rate_limit::FIELDS)
        .collect::<Vec<_>>();
    // example:knowledge:config-reference:start
    let fields = fields
        .into_iter()
        .chain(saas_app::modules::knowledge::CONFIG_FIELDS)
        .collect::<Vec<_>>();
    // example:knowledge:config-reference:end
    println!("{}", serde_json::to_string_pretty(&fields)?);
    Ok(())
}
