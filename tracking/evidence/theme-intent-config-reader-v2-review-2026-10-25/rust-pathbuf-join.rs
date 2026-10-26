use std::path::PathBuf;
fn main() {
    let inputs = [
        "C:\\Users\\jorda\\AppData\\Local",
        "C:\\Users\\jorda\\AppData\\Local\\",
        "C:\\Users\\jorda\\AppData\\Local\\\\",
        "C:\\Users\\jorda\\AppData\\Local/",
        "C:/Users/jorda/AppData/Local",
        "C:\\",
        "C:",
        "c:\\users\\JORDA\\appdata\\local",
    ];
    for i in inputs {
        let root = PathBuf::from(i).join("com.creatoragent.studio");
        let lower = root.to_string_lossy().to_lowercase();
        println!("{}\t{}", i, lower);
    }
}
