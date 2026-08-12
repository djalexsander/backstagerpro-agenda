mod printing;

#[derive(serde::Serialize, Clone)]
struct PrinterInfo {
  name: String,
  is_default: bool,
}

#[derive(serde::Deserialize)]
struct RawWindowsPrinter {
  #[serde(rename = "Name")]
  name: String,
  #[serde(rename = "Default")]
  default: Option<bool>,
}

// No native printing plugin is installed (see Cargo.toml) - enumeration
// shells out to PowerShell's CIM/WMI printer class instead of pulling in a
// WinAPI binding crate just for this. `@(...)` around the pipeline plus
// `-InputObject` (rather than piping into ConvertTo-Json) is required so a
// single matching printer still serializes as a JSON array and not a bare
// object - verified interactively against Get-CimInstance Win32_Printer
// before wiring this up.
#[tauri::command]
fn list_windows_printers() -> Result<Vec<PrinterInfo>, String> {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;

    let output = Command::new("powershell")
      .args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "ConvertTo-Json -InputObject @(Get-CimInstance Win32_Printer | Select-Object Name,Default)",
      ])
      .output()
      .map_err(|error| format!("Não foi possível consultar as impressoras do Windows: {error}"))?;

    if !output.status.success() {
      return Err(format!(
        "O Windows retornou um erro ao listar as impressoras: {}",
        String::from_utf8_lossy(&output.stderr).trim()
      ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw: Vec<RawWindowsPrinter> = serde_json::from_str(stdout.trim())
      .map_err(|error| format!("Resposta inesperada do Windows ao listar impressoras: {error}"))?;

    return Ok(
      raw
        .into_iter()
        .map(|printer| PrinterInfo { name: printer.name, is_default: printer.default.unwrap_or(false) })
        .collect(),
    );
  }

  #[cfg(not(target_os = "windows"))]
  {
    Err("Detecção automática de impressoras está disponível apenas no Windows.".to_string())
  }
}

// Whether a real WhatsApp Desktop install is registered to handle the
// whatsapp:// URI scheme - checked before attempting that protocol so the
// caller can go straight to the wa.me fallback instead of triggering
// Windows' own "choose an app"/Store-search resolver. That resolver is
// what ShellExecuteExW opens (and reports success for, via the opener
// plugin) when only the bare protocol marker is registered with no real
// handler behind it.
//
// Two install shapes exist and only one of them shows up under
// shell\open\command:
//   - Traditional Win32 installs (the .exe from whatsapp.com/download)
//     register HKCR\whatsapp\shell\open\command with the target exe -
//     that's what ShellExecuteExW itself resolves to launch the app, and
//     the first check below.
//   - Packaged/MSIX installs (the Microsoft Store build) never write
//     shell\open\command at all. Protocol activation for a packaged app is
//     resolved by the OS's Activation Manager against the package's
//     AppxManifest.xml (<uap:Extension Category="windows.protocol"><uap:
//     Protocol Name="whatsapp">), indexed into the AppRepository state
//     database (StateRepository-Machine.srd), not the classic COM verb
//     registry - HKCR\ActivatableClasses\Package has no entry for it
//     either. All the registry ever gets is the same bare "URL Protocol"
//     marker a phantom/orphaned stub would have.
// Confirmed interactively on a machine with the Store build installed:
// HKCU\Software\Classes\whatsapp has "URL Protocol" and no shell subkey,
// Get-AppxPackage lists 5319275A.WhatsAppDesktop (SignatureKind: Store),
// and its AppxManifest.xml does declare the whatsapp protocol extension.
// So when shell\open\command is absent, a second check asks Windows
// directly whether a WhatsApp package is installed for the current user -
// there's no registry key left to inspect instead. `@(...)` forces an
// array so zero matches prints "0" instead of erroring on a null pipeline,
// same reasoning as list_windows_printers above.
#[tauri::command]
fn is_whatsapp_app_available() -> bool {
  #[cfg(target_os = "windows")]
  {
    use std::process::Command;

    let has_traditional_handler = Command::new("reg")
      .args(["query", r"HKCR\whatsapp\shell\open\command"])
      .output()
      .map(|output| output.status.success())
      .unwrap_or(false);

    if has_traditional_handler {
      return true;
    }

    Command::new("powershell")
      .args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "@(Get-AppxPackage -Name '*WhatsApp*').Count",
      ])
      .output()
      .ok()
      .filter(|output| output.status.success())
      .and_then(|output| String::from_utf8_lossy(&output.stdout).trim().parse::<u32>().ok())
      .map(|count| count > 0)
      .unwrap_or(false)
  }

  #[cfg(not(target_os = "windows"))]
  {
    false
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // Not run by `cargo test` by default - the result depends on what's
  // actually installed on the host, so this is a manual check for
  // verifying is_whatsapp_app_available() against a real Windows install.
  // Run with: cargo test manual_check_whatsapp_available -- --ignored --nocapture
  #[test]
  #[ignore]
  fn manual_check_whatsapp_available() {
    println!("is_whatsapp_app_available() -> {}", is_whatsapp_app_available());
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![
      list_windows_printers,
      is_whatsapp_app_available,
      printing::print_label_batch
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
