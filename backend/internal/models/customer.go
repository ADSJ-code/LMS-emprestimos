package models

const CustomerCollection = "customers"

type Client struct {
	ID                    any    `bson:"_id,omitempty" json:"id"`
	Indicacao             string `json:"indicado"`
	CPF                   string `json:"cpf"`
	DataNascimento        string `json:"data_nascimento"`
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
	Name                  string `json:"name" bson:"name"`
	Phone                 string `json:"phone" bson:"phone"`
	Status                string `json:"status" bson:"status"`
	City                  string `json:"city" bson:"city"`
}
