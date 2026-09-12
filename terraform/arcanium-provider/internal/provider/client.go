// client.go — a deliberately small HTTP client, stdlib only.
//
// This provider is a skeleton proving the M2M integration surface
// (prompts/28_external_integration_key_lifecycle.md, Deliverable 4) is
// actually usable, not a production-grade SDK — so it talks directly to
// arcanium-api's own /api/v1 routes (the same ones Deliverables 1/2 proved
// work over a Bearer token), not through the Nuxt UI gateway, and pulls in
// no HTTP client library beyond net/http.
package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL string
	token   string
	http    *http.Client
}

func NewClient(baseURL, token string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		http:    &http.Client{Timeout: 15 * time.Second},
	}
}

// apiError mirrors arcanium-api's own JSON error body ({"error": "...", ...})
// closely enough to surface a useful message, without depending on its exact
// shape (routes vary slightly in what else they attach).
type apiError struct {
	StatusCode int
	Body       string
}

func (e *apiError) Error() string {
	return fmt.Sprintf("arcanium API returned %d: %s", e.StatusCode, e.Body)
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encoding request body: %w", err)
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}
	// The exact same "Authorization: Bearer <token>" scheme
	// arcanium-api/src/auth/index.js's requireSession checks FIRST, ahead of
	// the human cookie path (Deliverable 2) — this is the whole point of the
	// proof: no cookie, no session, just a service-account token.
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("calling arcanium API: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response body: %w", err)
	}

	if resp.StatusCode >= 300 {
		return &apiError{StatusCode: resp.StatusCode, Body: string(respBody)}
	}

	if out != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decoding response body: %w", err)
		}
	}
	return nil
}

// --- applications ---

type Application struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Description   *string `json:"description"`
	SupplierID    *string `json:"supplier_id"`
	Environment   string  `json:"environment"`
	RegisteredAt  string  `json:"registered_at,omitempty"`
}

type createApplicationBody struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	SupplierID  *string `json:"supplier_id,omitempty"`
	Environment string  `json:"environment,omitempty"`
}

func (c *Client) CreateApplication(ctx context.Context, name string, description, supplierID *string, environment string) (*Application, error) {
	var out Application
	err := c.do(ctx, http.MethodPost, "/api/v1/applications", createApplicationBody{
		Name:        name,
		Description: description,
		SupplierID:  supplierID,
		Environment: environment,
	}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) GetApplication(ctx context.Context, id string) (*Application, error) {
	var out Application
	if err := c.do(ctx, http.MethodGet, "/api/v1/applications/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

type patchApplicationBody struct {
	Description *string `json:"description,omitempty"`
}

func (c *Client) UpdateApplication(ctx context.Context, id string, description *string) (*Application, error) {
	var out Application
	err := c.do(ctx, http.MethodPatch, "/api/v1/applications/"+id, patchApplicationBody{
		Description: description,
	}, &out)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (c *Client) DeleteApplication(ctx context.Context, id string) error {
	return c.do(ctx, http.MethodDelete, "/api/v1/applications/"+id, nil, nil)
}

// IsNotFound lets the resource's Read distinguish "gone, drop from state"
// from a genuine transport/auth failure that should fail the plan instead.
func IsNotFound(err error) bool {
	apiErr, ok := err.(*apiError)
	return ok && apiErr.StatusCode == 404
}

// --- suppliers (name -> id resolution; the HCL surface takes a supplier
// NAME, e.g. "pepsi", matching prompts/28's own example — arcanium-api
// itself only takes a supplier_id UUID) ---

type Supplier struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (c *Client) FindSupplierByName(ctx context.Context, name string) (*Supplier, error) {
	var out []Supplier
	if err := c.do(ctx, http.MethodGet, "/api/v1/suppliers", nil, &out); err != nil {
		return nil, err
	}
	for _, s := range out {
		if s.Name == name {
			return &s, nil
		}
	}
	return nil, fmt.Errorf("no supplier named %q", name)
}

func (c *Client) GetSupplier(ctx context.Context, id string) (*Supplier, error) {
	var out Supplier
	if err := c.do(ctx, http.MethodGet, "/api/v1/suppliers/"+id, nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// --- application intent (data source) ---

// ApplicationIntent is intentionally loosely typed (map[string]any) rather
// than a fully-modeled struct: aggregation/intent.js's response shape is
// wide and has grown across several prompts (Prompt 27's environment/
// offboarding fields included) — the data source below only lifts out the
// specific fields it declares in its schema, so it doesn't need (or want)
// to track every field arcanium-api's intent view happens to return.
func (c *Client) GetApplicationIntent(ctx context.Context, id string) (map[string]any, error) {
	var out map[string]any
	if err := c.do(ctx, http.MethodGet, "/api/v1/applications/"+id+"/intent", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}
