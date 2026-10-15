# Corrige Fácil

Aplicativo gratuito para criar sessões de prova, fotografar folhas de respostas e acompanhar o desempenho da turma. Fotos e PDFs são processados no navegador; somente textos revisados, respostas e resultados são persistidos.

## Usar o aplicativo

- [Versão no GitHub Pages](https://igorgpaula.github.io/corrige-facil/)
- [Versão no OpenAI Sites](https://corrige-facil-provas.gdmseeds-whe-7678.chatgpt.site/)

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
