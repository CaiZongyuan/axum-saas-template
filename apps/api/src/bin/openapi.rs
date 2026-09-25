fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", saas_api::openapi().to_pretty_json()?);
    Ok(())
}
