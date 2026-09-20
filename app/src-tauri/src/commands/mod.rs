//! Los comandos que la interfaz puede invocar.
//!
//! Cada comando es una puerta fina: recibe lo que manda la interfaz, llama a
//! `galera-core` o al estado, y devuelve el resultado. Sin lógica propia
//! (principio 5 del README).
//!
//! Lo que devuelven se serializa a JSON con los nombres en `camelCase`, que es
//! como se escriben en TypeScript. Cuando fallan, devuelven un
//! [`CommandError`], que llega a la interfaz como `{ kind, message }`.

pub mod assets;
mod error;
pub mod export;
pub mod fonts;
pub mod ops;
pub mod project;
pub mod recovery;
pub mod render;
pub mod selection;
pub mod session;
pub mod text;

pub use error::CommandError;
