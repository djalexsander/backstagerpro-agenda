
-- Delete all data except master admin user (92705736-b829-4145-bbba-537e6823a24c)

-- Delete event-related data
DELETE FROM event_files;
DELETE FROM event_funcionarios;
DELETE FROM event_days;
DELETE FROM financials;
DELETE FROM events;

-- Delete company-related data
DELETE FROM generated_documents;
DELETE FROM document_templates;
DELETE FROM backups;
DELETE FROM pagamentos;
DELETE FROM notificacoes_master;
DELETE FROM system_logs;

-- Delete user linkage data (except master admin)
DELETE FROM empresa_usuarios;
DELETE FROM user_roles WHERE user_id != '92705736-b829-4145-bbba-537e6823a24c';
DELETE FROM profiles WHERE user_id != '92705736-b829-4145-bbba-537e6823a24c';

-- Delete empresas
DELETE FROM empresas;
