-- Dados de demonstração: clínica "demo" -> /agendar/demo
insert into clinics (id, slug, name, phone, address, public_booking_status, slot_interval_min, min_notice_min)
values ('00000000-0000-0000-0000-000000000001', 'demo', 'Clínica Salus Demo',
        '(11) 99999-0000', 'Av. Paulista, 1000 - Bela Vista, São Paulo/SP', 'reservado', 30, 60);

insert into rooms (id, clinic_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Sala 1'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Sala 2');

insert into professionals (id, clinic_id, name, specialty, home_care_enabled, travel_buffer_min) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'Dra. Ana Souza', 'Fisioterapeuta', true, 30),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'Dr. Bruno Lima', 'Nutricionista', false, 0);

insert into procedures (id, clinic_id, name, description, duration_min, price, allows_clinic, allows_home_care, requires_room) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
   'Sessão de fisioterapia', 'Avaliação e sessão individual', 60, 180.00, true, true, true),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000001',
   'Consulta nutricional', 'Primeira consulta com plano alimentar', 45, 220.00, true, false, true),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000001',
   'Retorno', 'Consulta de acompanhamento', 30, 120.00, true, false, true);

insert into professional_procedures (professional_id, procedure_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c3'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c2'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c3');

-- Seg a sex 08h-18h com almoço 12h-13h; sábado 08h-12h
insert into working_hours (professional_id, weekday, start_time, end_time)
select p.id, d, '08:00', '18:00'
from professionals p, generate_series(1, 5) d
where p.clinic_id = '00000000-0000-0000-0000-000000000001';

insert into working_hours (professional_id, weekday, start_time, end_time)
select p.id, 6, '08:00', '12:00'
from professionals p where p.clinic_id = '00000000-0000-0000-0000-000000000001';

insert into professional_breaks (professional_id, weekday, start_time, end_time, label)
select p.id, d, '12:00', '13:00', 'Almoço'
from professionals p, generate_series(1, 5) d
where p.clinic_id = '00000000-0000-0000-0000-000000000001';
