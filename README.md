# Corrige Fácil

Aplicativo gratuito para criar sessões de prova, fotografar folhas de respostas e acompanhar o desempenho da turma. Fotos e PDFs são processados no navegador; somente textos revisados, respostas e resultados são persistidos.

## Usar o aplicativo

- [Escolher uma versão](https://igorgpaula.github.io/corrige-facil/)
- [Corrige Fácil v1.0 — versão simples](https://igorgpaula.github.io/corrige-facil/v1/)
- [Corrige Fácil v2.0 — sessões e estatísticas](https://igorgpaula.github.io/corrige-facil/v2/)
- [Versão no OpenAI Sites](https://corrige-facil-provas.gdmseeds-whe-7678.chatgpt.site/)

## Versões

- **v1.0:** correção rápida, sem cadastro, com dados somente no aparelho.
- **v2.0:** login Google, sessões, leitura da prova em branco, histórico e estatísticas.

O código histórico da v1.0 está fixado na tag Git `v1.0.0`. A linha principal do projeto contém a v2.0.

## Desenvolvimento

```bash
pnpm install
pnpm dev
```

## Configurar o Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/).
2. Ative o provedor Google em **Authentication > Sign-in method**.
3. Crie o banco Firestore e publique as regras de `firestore.rules`.
4. Registre um aplicativo Web e adicione `igorgpaula.github.io` aos domínios autorizados do Authentication.
5. Cadastre no repositório, em **Settings > Secrets and variables > Actions > Variables**, as variáveis:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`

Para desenvolvimento local, copie `.env.example` para `.env.local` e preencha os mesmos valores. Sem eles, o app inicia em modo local para testes.

## Validação e publicação

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

O GitHub Actions executa testes, verifica os tipos e publica automaticamente no GitHub Pages a cada envio para `main`.
