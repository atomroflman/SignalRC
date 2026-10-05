using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text;

namespace LteCar.Server.Data
{
    public class User : EntityBase
    {
        private const string RecoveryKeyAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

        public string? Name { get; set; }
        public int? ActiveVehicleId { get; set; }
        public Car? ActiveVehicle { get; set; }
        public DateTime LastSeen { get; set; } = DateTime.Now;
        public DateTime? LastLogin { get; set; }
        public long? TransferCode { get; set; }
        public long SessionId { get; set; }
        public DateTime? TransferCodeExpiresAt { get; set; }
        public ICollection<UserChannelDevice> UserChannelDevices { get; set; } = new List<UserChannelDevice>();
        public ICollection<UserCarSetup> CarSetups { get; set; } = new List<UserCarSetup>();

        public bool HasControlledCar { get; set; }
        public string? PasswordHash { get; set; }
        public string? LoginName { get; set; }
        public string? RecoveryKeyHash { get; set; }
        public DateTime? RecoveryKeyCreatedAt { get; set; }

        public void SetPassword(string password)
        {
            using var sha256 = SHA256.Create();
            var salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
            var hash = Convert.ToBase64String(sha256.ComputeHash(Encoding.UTF8.GetBytes(password + salt)));
            PasswordHash = $"{salt}:{hash}";
            LoginName = Name;
        }

        public bool ValidatePassword(string password)
        {
            if (string.IsNullOrEmpty(PasswordHash))
                return false;

            var parts = PasswordHash.Split(':');
            if (parts.Length != 2)
                return false;

            var salt = parts[0];
            var storedHash = parts[1];

            using var sha256 = SHA256.Create();
            var computedHash = Convert.ToBase64String(sha256.ComputeHash(Encoding.UTF8.GetBytes(password + salt)));

            return storedHash == computedHash;
        }

        public static string GenerateRecoveryKey()
        {
            var bytes = RandomNumberGenerator.GetBytes(16);
            var chars = new char[16];
            for (var i = 0; i < 16; i++)
            {
                chars[i] = RecoveryKeyAlphabet[bytes[i] % RecoveryKeyAlphabet.Length];
            }
            return $"{new string(chars, 0, 4)}-{new string(chars, 4, 4)}-{new string(chars, 8, 4)}-{new string(chars, 12, 4)}";
        }

        public void SetRecoveryKey(string key)
        {
            using var sha256 = SHA256.Create();
            RecoveryKeyHash = Convert.ToBase64String(sha256.ComputeHash(Encoding.UTF8.GetBytes(NormalizeRecoveryKey(key))));
            RecoveryKeyCreatedAt = DateTime.UtcNow;
        }

        public bool ValidateRecoveryKey(string key)
        {
            if (string.IsNullOrEmpty(RecoveryKeyHash) || string.IsNullOrEmpty(key))
                return false;

            using var sha256 = SHA256.Create();
            var computed = sha256.ComputeHash(Encoding.UTF8.GetBytes(NormalizeRecoveryKey(key)));
            var stored = Convert.FromBase64String(RecoveryKeyHash);
            return CryptographicOperations.FixedTimeEquals(computed, stored);
        }

        public static string NormalizeRecoveryKey(string key)
        {
            return key.Replace("-", "", StringComparison.Ordinal).ToUpperInvariant();
        }
    }
}