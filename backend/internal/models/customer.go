package models

const CustomerCollection = "customers"

type Cliente struct {
	ID                    any    `bson:"_id,omitempty" json:"id"`
	Nome                  string `json:"nome"`
	Indicacao             string `json:"indicado"`
	CPF                   string `json:"cpf"`
	DataNascimento        string `json:"data_nascimento"`
	Telefone              string `json:"telefone"`
	Email                 string `json:"email"`
	Endereco              string `json:"endereco"`
	ModeloTrabalho        string `json:"modelo_trabalho"`
	Empresa               string `json:"empresa"`
	TempoEmpresa          string `json:"tempo_empresa"`
	Profissao             string `json:"profissao"`
	Salario               int64  `json:"salario"`
	ValeRefeicao          bool   `json:"vale_refeicao"`
	ValeAlimentacao       bool   `json:"vale_alimentacao"`
	CasaPropria           bool   `json:"casa_propria"`
	CasaAlugada           bool   `json:"casa_alugada"`
	ComprovanteResidencia bool   `json:"comprovante_residencia"`
	Estuda                bool   `json:"estuda"`
	QtOutrosEmprestimos   int8   `json:"outro_emprestimo"`
	ValorOutroEmprestimo  int64  `json:"valor_outro_emprestimo"`
	Filhos                int8   `json:"filhos"`
	Instagram             string `json:"instagram"`
	NomeSujo              bool   `json:"nome_sujo"`
	ValorEsperado         int64  `json:"valor_esperado"`
	ValorEmprestimo       int64  `json:"valor_emprestimo"`
}
