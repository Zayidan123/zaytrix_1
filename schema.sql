-- ZAYTRIX Database Schema (quoted identifiers for case preservation)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- users
CREATE TABLE IF NOT EXISTS public."users" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" TEXT UNIQUE NOT NULL,
  "password_hash" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "two_factor_enabled" BOOLEAN DEFAULT false NOT NULL,
  "totp_secret" TEXT,
  "email_verified" TIMESTAMP,
  "two_factor_secret" TEXT,
  "failed_login_attempts" INTEGER DEFAULT 0 NOT NULL,
  "locked_until" TIMESTAMP,
  "reset_token" TEXT,
  "reset_token_expiry" TIMESTAMP,
  "oauth_provider" TEXT,
  "oauth_id" TEXT,
  "breach_checked" TIMESTAMP,
  "breach_count" INTEGER DEFAULT 0 NOT NULL,
  "plan" TEXT DEFAULT 'free' NOT NULL,
  "role" TEXT DEFAULT 'user' NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TIMESTAMP NOT NULL,
  "api_keys" TEXT,
  "audit_logs" TEXT,
  "email_verification_tokens" TEXT,
  "sessions" TEXT,
  "webauthn_credentials" TEXT,
  "portfolio_holdings" TEXT,
  "ledger_transactions" TEXT,
  "backtest_results" TEXT,
  "conversions" TEXT,
  "alerts" TEXT,
  "chat_messages" TEXT,
  "ai_usage_events" TEXT,
  "paper_account" TEXT,
  "paper_orders" TEXT,
  "paper_positions" TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_email ON public."users"("email");
CREATE INDEX IF NOT EXISTS idx_users_oauth_id ON public."users"("oauth_id");

-- api_keys
CREATE TABLE IF NOT EXISTS public."api_keys" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "exchange" TEXT NOT NULL,
  "encrypted_key" TEXT NOT NULL,
  "encrypted_secret" TEXT NOT NULL,
  "encrypted_passphrase" TEXT,
  "label" TEXT DEFAULT 'default' NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_api_keys_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_user_exchange_label ON public."api_keys"("user_id", "exchange", "label");
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public."api_keys"("user_id");

-- audit_logs
CREATE TABLE IF NOT EXISTS public."audit_logs" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT,
  "action" TEXT NOT NULL,
  "ip" TEXT,
  "user_agent" TEXT,
  "metadata" TEXT,
  "success" BOOLEAN DEFAULT true NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_audit_logs_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public."audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON public."audit_logs"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created ON public."audit_logs"("action", "created_at");

-- email_verification_tokens
CREATE TABLE IF NOT EXISTS public."email_verification_tokens" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "token" TEXT UNIQUE NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_email_verification_tokens_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON public."email_verification_tokens"("user_id");

-- sessions
CREATE TABLE IF NOT EXISTS public."sessions" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT UNIQUE NOT NULL,
  "ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "last_seen" TIMESTAMP NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  CONSTRAINT fk_sessions_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public."sessions"("user_id");

-- portfolio_holdings
CREATE TABLE IF NOT EXISTS public."portfolio_holdings" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "purchase_price" NUMERIC(18,6) NOT NULL,
  "quantity" NUMERIC(18,6) NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TIMESTAMP NOT NULL,
  "purchase_price_dec" NUMERIC(18,6),
  "quantity_dec" NUMERIC(18,6),
  CONSTRAINT fk_portfolio_holdings_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_portfolio_holdings_user_id ON public."portfolio_holdings"("user_id");

-- ledger_transactions
CREATE TABLE IF NOT EXISTS public."ledger_transactions" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "timestamp" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "quantity" NUMERIC(18,6) NOT NULL,
  "price" NUMERIC(18,6) NOT NULL,
  "total_amount" NUMERIC(18,6) NOT NULL,
  "fee_paid_usd" NUMERIC(18,6) DEFAULT 0 NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "quantity_dec" NUMERIC(18,6),
  "price_dec" NUMERIC(18,6),
  "total_amount_dec" NUMERIC(18,6),
  "fee_paid_usd_dec" NUMERIC(18,6),
  "timestamp_dt" TIMESTAMP,
  CONSTRAINT fk_ledger_transactions_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_user_id ON public."ledger_transactions"("user_id");
CREATE INDEX IF NOT EXISTS idx_ledger_transactions_user_timestamp ON public."ledger_transactions"("user_id", "timestamp");

-- backtest_results
CREATE TABLE IF NOT EXISTS public."backtest_results" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "start_date" TEXT NOT NULL,
  "end_date" TEXT NOT NULL,
  "initial_capital" NUMERIC(18,6) NOT NULL,
  "final_capital" NUMERIC(18,6) NOT NULL,
  "total_return" NUMERIC(18,6) NOT NULL,
  "sharpe_ratio" NUMERIC(18,6),
  "max_drawdown" NUMERIC(18,6),
  "win_rate" NUMERIC(18,6),
  "total_trades" INTEGER NOT NULL,
  "equity_curve" TEXT NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "initial_capital_dec" NUMERIC(18,6),
  "final_capital_dec" NUMERIC(18,6),
  "total_return_dec" NUMERIC(18,6),
  "start_date_dt" TIMESTAMP,
  "end_date_dt" TIMESTAMP,
  CONSTRAINT fk_backtest_results_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_backtest_results_user_id ON public."backtest_results"("user_id");

-- conversion_transactions
CREATE TABLE IF NOT EXISTS public."conversion_transactions" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "from_symbol" TEXT NOT NULL,
  "from_amount" NUMERIC(18,6) NOT NULL,
  "to_symbol" TEXT NOT NULL,
  "to_amount" NUMERIC(18,6) NOT NULL,
  "rate" NUMERIC(18,6) NOT NULL,
  "timestamp" TEXT NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "from_amount_dec" NUMERIC(18,6),
  "to_amount_dec" NUMERIC(18,6),
  "rate_dec" NUMERIC(18,6),
  "timestamp_dt" TIMESTAMP,
  CONSTRAINT fk_conversion_transactions_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversion_transactions_user_id ON public."conversion_transactions"("user_id");

-- alert_configs
CREATE TABLE IF NOT EXISTS public."alert_configs" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "condition" TEXT NOT NULL,
  "target_price" NUMERIC(18,6) NOT NULL,
  "created_at" TEXT NOT NULL,
  "triggered" BOOLEAN DEFAULT false NOT NULL,
  "triggered_at" TIMESTAMP,
  "trigger_price" NUMERIC(18,6),
  "target_price_dec" NUMERIC(18,6),
  "trigger_price_dec" NUMERIC(18,6),
  "created_at_dt" TIMESTAMP,
  CONSTRAINT fk_alert_configs_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alert_configs_user_id ON public."alert_configs"("user_id");
CREATE INDEX IF NOT EXISTS idx_alert_configs_triggered_created ON public."alert_configs"("triggered", "created_at");

-- webauthn_credentials
CREATE TABLE IF NOT EXISTS public."webauthn_credentials" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "credential_id" TEXT UNIQUE NOT NULL,
  "public_key" TEXT NOT NULL,
  "counter" INTEGER DEFAULT 0 NOT NULL,
  "device_type" TEXT,
  "transports" TEXT,
  "name" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "last_used" TIMESTAMP,
  CONSTRAINT fk_webauthn_credentials_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON public."webauthn_credentials"("user_id");

-- chat_messages
CREATE TABLE IF NOT EXISTS public."chat_messages" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "model" TEXT,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_chat_messages_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_created ON public."chat_messages"("user_id", "created_at");

-- ai_usage_events
CREATE TABLE IF NOT EXISTS public."ai_usage_events" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT,
  "endpoint" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT,
  "tokens_in" INTEGER DEFAULT 0 NOT NULL,
  "tokens_out" INTEGER DEFAULT 0 NOT NULL,
  "cost_usd" NUMERIC(18,6) DEFAULT 0 NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_ai_usage_events_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_created ON public."ai_usage_events"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created ON public."ai_usage_events"("created_at");

-- paper_accounts
CREATE TABLE IF NOT EXISTS public."paper_accounts" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT UNIQUE NOT NULL,
  "cash_usd" NUMERIC(18,6) DEFAULT 10000 NOT NULL,
  "starting_usd" NUMERIC(18,6) DEFAULT 10000 NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" TIMESTAMP NOT NULL,
  CONSTRAINT fk_paper_accounts_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);

-- paper_orders
CREATE TABLE IF NOT EXISTS public."paper_orders" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "quantity" NUMERIC(18,6) NOT NULL,
  "price_usd" NUMERIC(18,6) NOT NULL,
  "notional_usd" NUMERIC(18,6) NOT NULL,
  "fee_usd" NUMERIC(18,6) DEFAULT 0 NOT NULL,
  "status" TEXT DEFAULT 'FILLED' NOT NULL,
  "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT fk_paper_orders_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_paper_orders_user_created ON public."paper_orders"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS idx_paper_orders_user_symbol ON public."paper_orders"("user_id", "symbol");

-- paper_positions
CREATE TABLE IF NOT EXISTS public."paper_positions" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "quantity" NUMERIC(18,6) NOT NULL,
  "avg_price_usd" NUMERIC(18,6) NOT NULL,
  "realized_pnl_usd" NUMERIC(18,6) DEFAULT 0 NOT NULL,
  "updated_at" TIMESTAMP NOT NULL,
  CONSTRAINT fk_paper_positions_user FOREIGN KEY ("user_id") REFERENCES public."users"("id") ON DELETE CASCADE,
  CONSTRAINT uq_paper_positions_user_symbol UNIQUE ("user_id", "symbol")
);
