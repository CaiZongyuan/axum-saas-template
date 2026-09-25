fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("{}", saas_app::openapi().to_pretty_json()?);
    Ok(())
}
