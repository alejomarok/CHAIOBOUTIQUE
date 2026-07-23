import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireUser } from "@/modules/auth";

export const metadata = { title: "Mi perfil" };

export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Mi perfil</h1>
        <p className="text-muted-foreground text-sm">Tu información y seguridad de la cuenta.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Información</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">Nombre</p>
            <p className="text-muted-foreground text-sm">{user.name}</p>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Roles</p>
            <div className="flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {role}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cambiar contraseña</CardTitle>
          <CardDescription>
            Al cambiarla, cerramos tus otras sesiones activas por seguridad.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
