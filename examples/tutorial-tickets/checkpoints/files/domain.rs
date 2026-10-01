// region:content
pub struct Content {
    pub title: String,
    pub description: String,
}

impl Content {
    pub fn new(title: String, description: String) -> Option<Self> {
        let title = title.trim().to_owned();
        if title.is_empty()
            || title.chars().count() > 200
            || description.len() > 8192
            || title.contains('\0')
            || description.contains('\0')
        {
            return None;
        }
        Some(Self { title, description })
    }
}
// endregion:content
