# Backstage Pro Agenda

## Requisitos

- Node.js 20.19 ou superior na linha 20, ou Node.js 22.12 ou superior.
- npm 10 ou superior.

O npm é o gerenciador de pacotes oficial deste projeto. O `package-lock.json`
deve ser mantido versionado e é a fonte das versões reproduzíveis.

## Instalação

```sh
npm ci
```

## Desenvolvimento

```sh
npm run dev
```

## Modelo multiempresa

O vínculo oficial de um usuário com uma empresa é `profiles.empresa_id`.
O sistema atual admite uma única empresa por usuário comum, pois os papéis são
globais e não existe troca de empresa no frontend.

`empresa_usuarios` é uma projeção protegida desse vínculo, usada para listagens
e limites do plano. Ela é reconciliada e sincronizada por triggers; não deve ser
gravada diretamente pela aplicação. As políticas RLS obtêm a empresa do usuário
por `get_user_empresa_id`, que exige consistência entre as duas tabelas e falha
de forma fechada se houver divergência.
