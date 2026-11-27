import { Notice, Screen, Title } from '@/components/ui';
import { useClinic } from '@/features/panel/clinic-context';
import { PatientList } from '@/features/records/PatientList';
import { cap, vocab } from '@/features/records/vocab';

/** Módulo Pacientes: lista de pacientes/clientes da clínica. */
export default function PatientsScreen() {
  const { clinic, modules } = useClinic();
  const words = vocab(clinic.record_vocabulary);
  return (
    <Screen wide safeTop={false}>
      <Title>{cap(words.people)}</Title>
      {modules.includes('pacientes') ? (
        <PatientList />
      ) : (
        <Notice tone="warning">O módulo Pacientes não está contratado para esta clínica. Fale com o suporte para ativar.</Notice>
      )}
    </Screen>
  );
}
