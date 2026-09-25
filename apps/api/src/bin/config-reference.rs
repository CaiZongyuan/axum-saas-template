fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "{}",
        serde_json::to_string_pretty(saas_platform::config::FIELDS)?
    );
    Ok(())
}
