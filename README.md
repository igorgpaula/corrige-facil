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
4. Crie a coleção `authorizedUsers`. O ID de cada documento deve ser o e-mail autorizado em letras minúsculas e o documento deve conter o campo booleano `enabled: true`.
5. Registre um aplicativo Web e adicione `igorgpaula.github.io` aos domínios autorizados do Authentication.
6. Cadastre no repositório, em **Settings > Secrets and variables > Actions > Variables**, as variáveis:
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

## Leitor calibrado de gabaritos

- Em **Corrigir**, escolha **Opção 1: Gabarito de forma livre** para seu próprio quadro ou **Opção 2: Gabarito padronizado pelo app** para a folha gerada pelo aplicativo.
- **Cadastrar modelo de respostas** recebe uma foto do quadro **em branco**. Não é a importação dos enunciados da prova. Confira a sobreposição antes de cadastrar.
- O novo quadro compacto tem **uma coluna de 1 a 50 questões**, quatro marcadores quadrados, dois pontos de identificação e letras fora dos círculos. Não há cabeçalho, rodapé, dados da sessão ou borda externa. A quantidade é a da sessão. Acima de 25 questões, os círculos têm 4 mm (em vez de 5 mm) para manter todas as linhas em uma página A4, sem sobreposição.
- **Imprimir folha** gera somente o quadro padronizado em A4 retrato. Escolha **Salvar como PDF** para importar no Canva. Posicione o quadro completo em qualquer lugar da primeira folha e redimensione proporcionalmente, sem distorcer, recortar marcadores ou mover alternativas separadamente. Evite reduzir demais. Ao fotografar, enquadre de perto **somente o quadro inteiro**, não a prova inteira. Na correção, selecione **Gabarito padronizado pelo app**.
- As folhas anteriores do padrão V2, inclusive as de duas colunas, continuam reconhecidas. A segunda marca circular identifica o novo desenho; a geometria dos círculos também é conferida para que uma marca ausente não provoque leitura segura com o desenho errado. Folhas antigas sem indicação de orientação exigem alinhamento assistido.
- O identificador persistido `builtin:standard-v2` e a versão 2 dos modelos representam a família de leitura por marcadores. A edição do desenho é identificada **na imagem**: um ponto usa a geometria V2; pontos em 14% e 23% usam a coluna única anterior (V3); pontos em 14% e 32% usam o quadro compacto (V4). Não é necessário migrar sessões ou modelos. O leitor confere também a primeira e a última linha para evitar aceitar uma grade deslocada.
- Quando a geometria não for segura, informe A e E da primeira e da última questão. Há ampliação e ajuste pelas setas do teclado. No quadro padronizado, indique os centros dos quatro marcadores.
- Letras sugeridas não são respostas aceitas. Revise as pendências, confirme branco ou anule uma marcação múltipla. A nota é provisória até resolver todas as pendências.
- Confiança é uma estimativa heurística, não uma probabilidade calibrada. A revisão visual continua importante, inclusive nas leituras de confiança alta.
- O leitor combina as duas máscaras adaptativas com uma máscara de **contraste local**, normalizada pelo papel ao redor de cada bolinha. A mesma medição atende tinta preta e azul: exige contraste, preenchimento em quatro setores e separação da segunda alternativa. Só reforça a aceitação quando as leituras concordam; duas marcas fortes ou conflito continuam exigindo revisão. O corte de aceitação permanece em 80%, limitado pela qualidade do alinhamento.
- Os detalhes numéricos por questão ficam em `ScanResult.diagnostics.questions`, somente na memória. Permitem distinguir a confiança anterior da evidência de contraste sem armazenar fotos nem modificar correções salvas. Esta melhoria atende preenchimentos fortes; não constitui um reconhecedor específico de X.

O OpenCV **4.12.0**, distribuído por `@techstark/opencv-js@4.12.0-release.1`, é servido pelo próprio site, com WASM incorporado, e carregado sob demanda em Worker. A primeira análise baixa aproximadamente 11 MB; as seguintes podem reutilizar o cache. Licença e alteração de compatibilidade estão em `public/vendor/`.

Fotos, sobreposições, sugestões e diagnósticos não são persistidos. O Worker é encerrado ao terminar ou cancelar; resultados atrasados são ignorados. Modelos guardam somente geometria normalizada e estatísticas numéricas, em `users/{uid}/answerSheetTemplates`. Sessões bloqueadas permitem mudar a identificação (título e turma), o estado e a associação ao modelo, sem alterar a prova ou as correções.

## Identificação e exportação da sessão

- **Editar título e turma** está disponível no cabeçalho inclusive após correções e em sessões arquivadas. Somente esses dois campos e o horário de atualização são alterados; para mudar questões, gabarito ou pontuação de uma sessão corrigida, duplique-a.
- Em **Estatísticas**, use **Extrair estatísticas** para baixar um PDF ou Excel com a turma e os resultados individuais. Os downloads incluem nomes/códigos quando informados; compartilhe-os apenas com pessoas autorizadas.
- O PDF contém resumo, dois gráficos, gargalos, melhores resultados, detalhes por questão e as correções individuais. O Excel tem as abas Resumo, Questões, Distribuição e Correções, com valores numéricos, filtros e cabeçalhos congelados. As datas usam o horário de Brasília.
- Os dois formatos usam o mesmo retrato das correções salvas e os mesmos cálculos do painel. Uma resposta nula é contabilizada como em branco, incluindo marcações anuladas. O Excel é um retrato da sessão, não um modelo de recálculo.
- A geração ocorre no aparelho, sem enviar arquivos ao Firebase. jsPDF 4.2.1, AutoTable 5.0.9 e ExcelJS 4.4.0 são carregados sob demanda. As fontes Noto Sans são empacotadas localmente; a licença OFL está em `assets/fonts/LICENSE.txt`.
- Antes do deploy, publique as regras atualizadas que permitem `title` e `className` em sessões bloqueadas, mantendo acesso exclusivo ao proprietário. Não há alteração na lista de professores autorizados.
- Para conferir os relatórios com dados fictícios, rode os testes com `EXPORT_QA=true`. Os exemplos ficam apenas em `work/statistics-qa`, fora da publicação.

Para validar cada leitura sem exceder o limite de expressões das regras do Firestore, a gravação atômica inclui pequenos documentos numéricos `readingChecks/{0…4}` sob cada correção. Isso acrescenta entre um e cinco documentos por correção, além da atualização da sessão. Eles são removidos junto com a correção; o formato público das correções e o histórico anterior permanecem compatíveis.

### Regressão local de imagens

As cinco fotografias de referência **não fazem parte do repositório nem da publicação**. Para executar a suíte opcional, defina `OMR_FIXTURES_DIR` com a pasta que contém os arquivos originais e rode `pnpm test`. A suíte compara todas as 50 marcações, mede aceitação/revisão separadamente e exige zero alternativas erradas aceitas como seguras.

Resultado do conjunto de referência em 19/10/2026, com contraste local:

| Foto         | Aceitas automaticamente |                                  Encaminhadas para revisão |
| ------------ | ----------------------: | ---------------------------------------------------------: |
| 18/10, 14:25 |                       0 | 10 — ajuste de quatro pontos; depois, 10 leituras corretas |
| 18/10, 15:04 |                      10 |                                                          0 |
| 07/09, 14:55 |                       6 |                                                          4 |
| 07/09, 15:02 |                       7 |                                                          3 |
| Designer     |                      10 |                                                          0 |

Não houve erros aceitos como seguros nesse conjunto. Isso não significa garantia de acerto em fotos futuras. Cenários sintéticos reservados verificam perspectiva, inclinação, resolução, iluminação, tinta azul/preta, lápis, branco e rasura dupla; eles não devem ser usados para ajustar os limiares.

A questão 10 da foto de 18/10 às 15:04 passou de sugestão A (78% na execução local sem modelo) para A aceita (81%, limitada pela geometria). A regressão também usa o quadro vazio de 07/09 às 13:39, uma conversão da foto para tons de cinza e a foto com X de 18/10 às 21:48, exigindo ausência de respostas erradas aceitas como seguras. `OMR_DIAGNOSTICS=true` imprime evidências numéricas locais para investigação; nenhum arquivo de imagem integra o deploy.

### Regras de segurança

Com o emulador Firestore em `127.0.0.1:8788`, defina `FIRESTORE_EMULATOR_HOST=127.0.0.1:8788` e rode `pnpm test`. Os testes usam somente o projeto fictício `demo-corrige`: verificam duas contas isoladas, sessões bloqueadas, quantidade incompatível, rejeição de imagens e pendências, e correções de até 50 questões. Não usam credenciais nem dados do projeto real.

Antes de publicar mudanças de persistência, publique também `firestore.rules` no projeto Firebase. A v1 permanece fixada na tag `v1.0.0` e não recebe alterações do leitor da v2.
