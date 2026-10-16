# Verificação — Dev Control 0.2.1

Ambiente: Linux, Claude Code 2.1.296. Validação e testes executados pelas ferramentas oficiais do produto.

- Plugin e marketplace: validação estrita aprovada.
- Instalação local da base 0.2.0: aprovada em configuração isolada; a versão 0.2.1 mantém o mesmo formato.
- Verificação do pacote: sem referências ao autor/projeto anterior e sem arquivos de código idênticos aos da base anterior.
- Testes: **34 aprovados, 0 falhas**, em dois arquivos escritos para esta implementação, incluindo atalhos em português e valores nativos de permissão.
- Cobertura: preferências, cores, JSONC, faixas de consumo, renovações, compactação, estados de progresso, interface terminal/desktop, notificações, intervalo entre avisos, falha de canal externo, continuidade, tarefas nativas, agentes, esforço de subagentes, perfis, temporizadores e preservação/restauração de configurações do Terminal.
- Não houve chamada paga ao modelo ou acesso ao computador do usuário.

Os testes de canais, arquivos, agentes e processos usam os substitutos de teste oficiais do executor. Ainda precisam de verificação física: aparência no terminal real, som, notificações do sistema e recarregamento de cores nas plataformas finais. Os testes de árvores de UI não equivalem a capturas da pintura real.

O pacote contém somente a implementação nova e sua documentação. Não inclui código-fonte de outro plugin, SDK copiado, binários do motor ou dependências de teste.

Para repetir na raiz do pacote:

```sh
claude plugin validate ./plugins/dev-control --strict
claude plugin test ./plugins/dev-control
claude plugin validate . --strict
```
