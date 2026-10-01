use crate::{diagnostic, Engine, Input, Reader, MAX_FILE};
use std::cell::RefCell;

#[used]
#[link_section = "sourcegraph.plugin.v1"]
static METADATA: [u8; include_bytes!("../plugin.json").len()] = *include_bytes!("../plugin.json");

#[link(wasm_import_module = "sourcegraph")]
extern "C" {
    fn read_file(path: u32, path_len: u32) -> u64;
    fn last_error() -> u64;
}

struct Host;
impl Reader for Host {
    fn read(&mut self, path: &str) -> Result<Vec<u8>, String> {
        let packed = unsafe { read_file(path.as_ptr() as u32, path.len() as u32) };
        if packed == 0 {
            // Consume and release host diagnostics, but do not echo possible host
            // paths or credentials into evidence. The requested path is reported.
            let error = unsafe { last_error() };
            if error != 0 {
                unsafe { dealloc((error >> 32) as u32, error as u32) };
            }
            return Err("Host could not read the requested repository file".into());
        }
        let pointer = (packed >> 32) as u32;
        let length = packed as u32;
        if length as usize > MAX_FILE {
            unsafe { dealloc(pointer, length) };
            return Err("File exceeds plugin read budget".into());
        }
        // The host allocates using our alloc export; take ownership without copying.
        let bytes = unsafe {
            Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                pointer as *mut u8,
                length as usize,
            ))
        };
        Ok(bytes.into_vec())
    }
}

thread_local! { static ENGINE: RefCell<Engine> = RefCell::new(Engine::default()); }

#[no_mangle]
pub extern "C" fn alloc(length: u32) -> u32 {
    let buffer = vec![0u8; length as usize].into_boxed_slice();
    Box::into_raw(buffer) as *mut u8 as u32
}

/// Host must pass only live allocations with their original exact lengths.
#[no_mangle]
pub unsafe extern "C" fn dealloc(pointer: u32, length: u32) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
        pointer as *mut u8,
        length as usize,
    )));
}

/// Return packed u64: high 32 bits pointer, low 32 bits byte length.
/// Input and output are separately owned; host deallocates both after copying.
#[no_mangle]
pub unsafe extern "C" fn enrich(pointer: u32, length: u32) -> u64 {
    let result = if length > 1024 * 1024 {
        diagnostic("INVALID_INPUT", "Input exceeds plugin budget")
    } else {
        let bytes = std::slice::from_raw_parts(pointer as *const u8, length as usize);
        match serde_json::from_slice::<Input>(bytes) {
            Ok(input) => ENGINE.with(|engine| engine.borrow_mut().enrich(input, &mut Host)),
            Err(_) => diagnostic(
                "INVALID_INPUT",
                "Expected ABI 2 input with item_id on every file and valid plugin arguments",
            ),
        }
    };
    let bytes = serde_json::to_vec(&result).unwrap().into_boxed_slice();
    let length = bytes.len() as u64;
    let pointer = Box::into_raw(bytes) as *mut u8 as u64;
    (pointer << 32) | length
}
