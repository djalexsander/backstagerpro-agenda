// Direct-to-spooler printing bridge for the desktop build. Renders happen
// entirely on the JS side (same label markup used by the web print flow,
// rasterized to PNG - see src/lib/printer-service.ts); this module only
// takes the resulting bitmap(s) and pushes them through the Windows print
// spooler via GDI (CreateDC/StartDoc/StartPage/StretchDIBits/EndPage/EndDoc),
// using the named printer's own default DEVMODE. That last part matters:
// passing `None` for the DEVMODE to CreateDCW means Windows applies whatever
// the driver already has configured for that queue (page size, orientation,
// GAP sensor, density/speed for label drivers) instead of us overriding it -
// exactly what's wanted for a printer whose driver is already tuned for a
// specific label stock.
//
// No TSPL/ZPL/ESC-POS here on purpose: going through the driver via GDI
// means any Windows-driver printer works (thermal label, receipt, A4),
// not just one command dialect - see docs/stage-6-physical-printing-homologation.md.

use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelImageJob {
  png_bytes: Vec<u8>,
  quantity: u32,
}

// Sentinel returned (verbatim, not wrapped in a sentence) when the named
// printer can't be opened - the frontend matches on this exact string to
// show "impressora não encontrada" instead of the generic spool-failure
// message (src/lib/printer-service.ts, printImagesToWindowsPrinter).
pub const PRINTER_NOT_FOUND: &str = "NOT_FOUND";

#[tauri::command]
pub fn print_label_batch(printer_name: String, document_name: String, jobs: Vec<LabelImageJob>) -> Result<(), String> {
  #[cfg(not(target_os = "windows"))]
  {
    let _ = (printer_name, document_name, jobs);
    return Err("Impressão direta no spooler está disponível apenas no Windows.".to_string());
  }

  #[cfg(target_os = "windows")]
  {
    windows_impl::print_label_batch(printer_name, document_name, jobs)
  }
}

#[cfg(target_os = "windows")]
mod windows_impl {
  use super::{LabelImageJob, PRINTER_NOT_FOUND};
  use std::ffi::c_void;
  use std::mem::size_of;
  use windows::core::PCWSTR;
  use windows::Win32::Graphics::Gdi::{
    CreateDCW, DeleteDC, GetDeviceCaps, StretchDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
    HORZRES, SRCCOPY, VERTRES,
  };
  use windows::Win32::Graphics::Printing::{ClosePrinter, OpenPrinterW, PRINTER_HANDLE};

  // StartDocW/StartPage/EndPage/EndDoc/AbortDoc/DOCINFOW are GDI print-job
  // APIs (gdi32.dll) - windows-rs 0.61 surfaces them under the
  // Win32_Storage_Xps feature, but enabling that feature makes rustc
  // 1.97.0 crash compiling the `windows` crate in this environment
  // (verified: reproducible, disappears when the feature is removed).
  // Declared by hand instead, against the same HDC/PCWSTR types used
  // everywhere else in this file - these five signatures are ABI-stable
  // Win32 APIs unchanged since Windows 2000, low risk to hand-declare.
  #[repr(C)]
  struct DocInfoW {
    cb_size: i32,
    doc_name: PCWSTR,
    output: PCWSTR,
    datatype: PCWSTR,
    fw_type: u32,
  }

  #[link(name = "gdi32")]
  extern "system" {
    fn StartDocW(hdc: HDC, doc_info: *const DocInfoW) -> i32;
    fn EndDoc(hdc: HDC) -> i32;
    fn StartPage(hdc: HDC) -> i32;
    fn EndPage(hdc: HDC) -> i32;
    fn AbortDoc(hdc: HDC) -> i32;
  }

  // UTF-16, NUL-terminated - every wide Win32 string call below needs this,
  // and the Vec must outlive the PCWSTR pointing into it.
  fn to_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
  }

  // OpenPrinterW is also the existence/reachability check: it fails for a
  // queue name that no longer exists (uninstalled/renamed driver) without
  // needing a second round-trip through list_windows_printers.
  fn printer_exists(printer_name_wide: &[u16]) -> bool {
    unsafe {
      let mut handle = PRINTER_HANDLE::default();
      match OpenPrinterW(PCWSTR(printer_name_wide.as_ptr()), &mut handle, None) {
        Ok(()) => {
          let _ = ClosePrinter(handle);
          true
        }
        Err(_) => false,
      }
    }
  }

  pub fn print_label_batch(printer_name: String, document_name: String, jobs: Vec<LabelImageJob>) -> Result<(), String> {
    if jobs.is_empty() {
      return Ok(());
    }

    let printer_name_wide = to_wide(&printer_name);
    if !printer_exists(&printer_name_wide) {
      return Err(PRINTER_NOT_FOUND.to_string());
    }

    // No DEVMODE override (last arg None) - uses the printer's current
    // default (size/orientation/GAP/density/speed already set in Windows).
    let hdc = unsafe { CreateDCW(PCWSTR::null(), PCWSTR(printer_name_wide.as_ptr()), PCWSTR::null(), None) };
    if hdc.is_invalid() {
      return Err(format!("Não foi possível abrir a impressora \"{printer_name}\" para impressão."));
    }

    let page_width = unsafe { GetDeviceCaps(Some(hdc), HORZRES) };
    let page_height = unsafe { GetDeviceCaps(Some(hdc), VERTRES) };
    if page_width <= 0 || page_height <= 0 {
      unsafe {
        let _ = DeleteDC(hdc);
      }
      return Err(format!("A impressora \"{printer_name}\" não informou um tamanho de página válido."));
    }

    let doc_name_wide = to_wide(&document_name);
    let docinfo = DocInfoW {
      cb_size: size_of::<DocInfoW>() as i32,
      doc_name: PCWSTR(doc_name_wide.as_ptr()),
      output: PCWSTR::null(),
      datatype: PCWSTR::null(),
      fw_type: 0,
    };

    if unsafe { StartDocW(hdc, &docinfo) } <= 0 {
      unsafe {
        let _ = DeleteDC(hdc);
      }
      return Err(format!("Não foi possível iniciar o trabalho de impressão em \"{printer_name}\"."));
    }

    let result = print_all_pages(hdc, page_width, page_height, &jobs);

    unsafe {
      if result.is_ok() {
        EndDoc(hdc);
      } else {
        AbortDoc(hdc);
      }
      let _ = DeleteDC(hdc);
    }

    result
  }

  fn print_all_pages(hdc: HDC, page_width: i32, page_height: i32, jobs: &[LabelImageJob]) -> Result<(), String> {
    for job in jobs {
      let decoded = image::load_from_memory_with_format(&job.png_bytes, image::ImageFormat::Png)
        .map_err(|error| format!("Falha ao decodificar a imagem da etiqueta: {error}"))?;
      let rgba = decoded.to_rgba8();
      let (width, height) = (rgba.width(), rgba.height());
      if width == 0 || height == 0 {
        return Err("A imagem da etiqueta veio vazia.".to_string());
      }
      let mut pixels = rgba.into_raw();
      // Windows 32bpp BI_RGB DIBs store bytes as B,G,R,A per pixel.
      for pixel in pixels.chunks_exact_mut(4) {
        pixel.swap(0, 2);
      }

      let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
          biSize: size_of::<BITMAPINFOHEADER>() as u32,
          biWidth: width as i32,
          biHeight: -(height as i32), // negative = top-down DIB, matches image's row order
          biPlanes: 1,
          biBitCount: 32,
          biCompression: BI_RGB.0,
          biSizeImage: 0,
          biXPelsPerMeter: 0,
          biYPelsPerMeter: 0,
          biClrUsed: 0,
          biClrImportant: 0,
        },
        bmiColors: Default::default(),
      };

      for _ in 0..job.quantity.max(1) {
        unsafe {
          if StartPage(hdc) <= 0 {
            return Err("Não foi possível iniciar uma página de impressão.".to_string());
          }
          // Stretch to fully fill the page the driver already reports for
          // this queue - the driver's own configured physical size (e.g.
          // 50x30mm) is what page_width/page_height represent, so this is
          // a 1:1 physical fit with no extra "fit to page" logic needed.
          StretchDIBits(
            hdc,
            0,
            0,
            page_width,
            page_height,
            0,
            0,
            width as i32,
            height as i32,
            Some(pixels.as_ptr() as *const c_void),
            &bmi,
            DIB_RGB_COLORS,
            SRCCOPY,
          );
          if EndPage(hdc) <= 0 {
            return Err("Não foi possível finalizar uma página de impressão.".to_string());
          }
        }
      }
    }
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  // Manual, like manual_check_whatsapp_available in lib.rs - depends on a
  // real printer being installed, not run by `cargo test` by default.
  // Run with: cargo test manual_check_print_label_batch -- --ignored --nocapture
  #[test]
  #[ignore]
  fn manual_check_print_label_batch() {
    // 1x1 white pixel PNG.
    let white_pixel_png: Vec<u8> = vec![
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
      0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0xFF, 0xFF, 0x3F, 0x00, 0x05, 0xFE, 0x02, 0xFE, 0xA7,
      0x35, 0x81, 0x84, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];
    let result = print_label_batch(
      "LABEL".to_string(),
      "manual_check_print_label_batch".to_string(),
      vec![LabelImageJob { png_bytes: white_pixel_png, quantity: 1 }],
    );
    println!("print_label_batch(\"LABEL\", ...) -> {result:?}");
  }
}
