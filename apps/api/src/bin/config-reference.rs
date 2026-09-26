fn main() -> Result<(), Box<dyn std::error::Error>> {
    let fields = saas_platform::config::FIELDS
        .iter()
        .chain(saas_platform::telemetry::FIELDS)
        .chain(saas_app::modules::jobs::FIELDS)
        .chain(saas_platform::cache::FIELDS)
        .chain(saas_app::modules::rate_limit::FIELDS)
        .chain(saas_platform::mail::FIELDS)
        .chain(saas_app::modules::mail::FIELDS)
        .chain(saas_app::modules::identity::PASSWORD_RESET_FIELDS)
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
