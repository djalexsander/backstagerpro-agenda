// Fonte única da versão da aplicação Web/PWA.
// O valor é injetado em tempo de build pelo Vite (`define.__APP_VERSION__`),
// que lê o package.json do commit que está sendo compilado.
// Não adicione nenhum número de versão hardcoded aqui.
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
