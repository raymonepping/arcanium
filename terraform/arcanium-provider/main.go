// terraform-provider-arcanium — Prompt 28, Deliverable 4.
//
// A skeleton provider, not published to the Terraform Registry. It exists
// solely to prove that `terraform apply` against a real Arcanium API,
// authenticated with a real service-account Bearer token (Deliverables 1/2),
// can create an application and read its intent view — the end-to-end proof
// that the M2M integration surface is usable, not just designed. See
// scenarios/17_terraform_provider/ for the actual proof run.
package main

import (
	"context"
	"flag"
	"log"

	"github.com/hashicorp/terraform-plugin-framework/providerserver"

	"github.com/hashicorp/arcanium/terraform/arcanium-provider/internal/provider"
)

// version is overridden at build time via:
//
//	go build -ldflags "-X main.version=x.y.z"
var version = "dev"

func main() {
	var debug bool
	flag.BoolVar(&debug, "debug", false, "run the provider with support for debuggers")
	flag.Parse()

	err := providerserver.Serve(context.Background(), provider.New(version), providerserver.ServeOpts{
		// Not registered on the Registry — this address is only used for the
		// local dev_overrides proof in scenarios/17_terraform_provider/.
		Address: "registry.terraform.io/hashicorp-demo/arcanium",
		Debug:   debug,
	})
	if err != nil {
		log.Fatal(err.Error())
	}
}
