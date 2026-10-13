# Verificação — Dev Control 0.1.0

Executada no Linux com Claude Code 2.1.296, usando o validador e o executor de testes oficiais.

- Validação estrita do plugin: aprovada, sem erros ou avisos.
- Testes: **43 aprovados, 0 falhas**, em dois arquivos.
- Marketplace: validação estrita aprovada.
- Instalação local: registro do marketplace e instalação do plugin aprovados em configuração isolada.
- Inclui testes das árvores de UI em terminal e desktop, alertas e ausência de repetição, reinício de janelas, compactação de contexto, perfis, atualização periódica, encerramento de timers, falha de notificação, preservação de resultados de ferramentas, Zen, subagentes e handoff.
- Testes de canais usam os stubs oficiais do executor. Não houve chamada paga ao modelo, acesso a projetos do usuário ou publicação no GitHub.

Ainda exige verificação física no ambiente final: aparência no terminal real, reprodução do som, notificação Windows/macOS/Linux, restrições da conta a function hooks e restauração de temas no Windows Terminal. O teste de árvores UI verifica comportamento e elementos; não é uma captura da pintura do aplicativo.

Para repetir, na raiz do pacote:

```sh
claude plugin validate ./plugins/dev-control --strict
claude plugin test ./plugins/dev-control
claude plugin validate . --strict
```
